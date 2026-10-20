/**
 * What a food a mint made is, asked of AI by the background pass (ADR-0037); an import asks
 * nothing. One language-model request under the administrator-editable `ingredient-resolution`
 * Prompt reads the name, with no catalogue in front of it: a food (its plain English name, the more
 * general food it is a kind of, and other names a shop sells it under), several foods, or not a
 * food. The code looks the names up as an import would. Only where they name more than one food is
 * a second question asked over just those: a Decision when a Decision Model is configured and this
 * use is on, and otherwise — or when the Decision is unsure, or fails — the language model
 * (ADR-0035).
 *
 * Nothing here throws: every failure is a warn log and a flagged answer.
 */
import { z } from "zod";

import type { IngredientCandidate } from "@norish/db/repositories/ingredient-aliases";
import type { FlagReason, ReviewTrace } from "@norish/shared/contracts/ingredient-catalogue";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import { findIngredientCandidatesByIds } from "@norish/db/repositories/ingredient-aliases";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { aiLogger } from "@norish/shared-server/logger";
import { OperationTimeoutError } from "@norish/shared/lib/error-extensions";
import { withTimeout } from "@norish/shared/lib/with-timeout";

import { findOtherFoodsNamed } from "../../ingredients/resolver";
import { isCredentialRejection } from "../runtime/errors";
import { decide, generateStructured } from "../runtime/runtime";

/**
 * At or above: the Decision's pick is acted on — a food it names as a known
 * one is merged into it. A wrong "same" lends one food's Product
 * Link and Aisle to another and nobody notices, where a wrong "new" is one
 * merge on the Ingredients page, so the bar is high. A named constant with a
 * test, never a setting.
 */
export const RESOLUTION_THRESHOLD = 0.8;

/** How many of a candidate's other names one question shows. */
const SHOWN_ALIASES = 5;

/**
 * What rung 3 made of a name: a known food, a food of its own (flagged unless sure, under the food it
 * is a kind of), several foods with their parts, or not a food.
 */
export type AIResolution =
  | { kind: "same"; ingredientId: string; sure: boolean }
  | { kind: "new"; kindOf: string | null; flagged: false; reason: null }
  | { kind: "new"; kindOf: string | null; flagged: true; reason: FlagReason }
  | { kind: "several"; parts: string[]; joined: LineJoin; sure: boolean }
  | { kind: "not-a-food"; sure: boolean };

/** A food of its own that nothing sure vouched for: flagged, and why. */
function flaggedNew(reason: FlagReason, kindOf: string | null = null): AIResolution {
  return { kind: "new", kindOf, flagged: true, reason };
}

/** The flagged answer for a failed request: a refused key says so, so the cause is not a guess. */
function failedNew(error: unknown): AIResolution {
  return flaggedNew(isCredentialRejection(error) ? "ai-key-rejected" : "ai-unavailable");
}

/** How a question is asked. */
export interface AskOptions {
  /** The Ingredient the question is about, never its own answer. */
  excludeId: string;
  /** How long to wait for an answer before flagging the food as unanswered instead. */
  budgetMs: number;
  /** Where to record what was asked, for a person who wants to know: filled in as it goes. */
  trace: AskTrace;
}

/** What one question came to: what AI read the name as, and the foods it then chose between. */
export type AskTrace = ReviewTrace;

/** Ask what `text` is: AI reads it, and the code looks the reading up. */
export async function askWhatFoodThisIs(text: string, options: AskOptions): Promise<AIResolution> {
  if (!(await isAIEnabled())) return flaggedNew("ai-off");

  return withTimeout(
    () => readThenLookUp(text, options.excludeId, options.trace),
    options.budgetMs,
    "Ingredient resolution"
  ).catch((error: unknown) => {
    if (!(error instanceof OperationTimeoutError)) throw error;

    aiLogger.warn(
      { feature: "ingredient-resolution", text, budgetMs: options.budgetMs },
      "Ingredient resolution ran out of time, flagging the Ingredient"
    );

    return flaggedNew("ai-unavailable");
  });
}

/**
 * The reading, looked up: a food the names find is the one; several found are asked about; none,
 * and the general food found is its parent; else a food of its own. Flagged unless AI was sure.
 */
async function readThenLookUp(
  text: string,
  excludeId: string,
  trace: AskTrace
): Promise<AIResolution> {
  let reading: Reading;

  try {
    reading = await readName(text);
  } catch (error) {
    aiLogger.warn({ err: error, feature: "ingredient-resolution", text }, "Reading a name failed");

    return failedNew(error);
  }

  if (reading.verdict === "not-a-food") return { kind: "not-a-food", sure: reading.sure };
  if (reading.verdict === "several") {
    trace.parts = reading.parts;

    return reading.parts.length > 1
      ? { kind: "several", parts: reading.parts, joined: reading.joined, sure: reading.sure }
      : flaggedNew("ai-unsure");
  }

  trace.englishName = reading.englishName;

  const names = [reading.englishName, ...reading.otherNames].filter((name) => name !== null);
  const [general, ...found] = await findOtherFoodsNamed(excludeId, [
    reading.generalFood ?? "",
    ...names,
  ]);
  const matches = [...new Set(found.filter((id) => id !== null))];

  if (matches.length === 1) return { kind: "same", ingredientId: matches[0]!, sure: reading.sure };
  if (matches.length > 1) {
    const candidates = await findIngredientCandidatesByIds(matches);

    trace.considered.push(...candidates.map((candidate) => candidate.name));
    const picked = await askAbout(text, candidates);

    if (picked !== null) {
      return picked.kind === "same" ? { ...picked, sure: picked.sure && reading.sure } : picked;
    }
  }

  const kindOf = general ?? null;

  return reading.sure
    ? { kind: "new", kindOf, flagged: false, reason: null }
    : flaggedNew("ai-unsure", kindOf);
}

/** What the language model read a name as. */
type Reading =
  | {
      verdict: "food";
      englishName: string | null;
      generalFood: string | null;
      otherNames: string[];
      sure: boolean;
    }
  | { verdict: "several"; parts: string[]; joined: LineJoin; sure: boolean }
  | { verdict: "not-a-food"; sure: boolean };

const readingSchema = z
  .object({
    verdict: z.enum(["food", "several", "not-a-food"]),
    englishName: z
      .string()
      .nullable()
      .describe("For food: its plain English name, as a shopper would look for it; else null."),
    generalFood: z
      .string()
      .nullable()
      .describe(
        "For food: the more general food it is a kind of, in plain English; null when there is none."
      ),
    otherNames: z
      .array(z.string())
      .nullable()
      .describe("For food: two or three other names a shop might sell it under; null when none."),
    parts: z
      .array(z.string())
      .nullable()
      .describe("For several: each food's name, in the language written; null otherwise."),
    joined: z
      .enum(["together", "alternatives"])
      .nullable()
      .describe("For several: together when all are needed, alternatives when any one will do."),
    sure: z.boolean(),
  })
  .strict();

/** What the language model reads a name as, with no catalogue in front of it. */
async function readName(text: string): Promise<Reading> {
  const answer = await generateStructured({
    prompt: "ingredient-resolution",
    schema: readingSchema,
    sections: [`Name: ${text}`],
  });
  const trimmed = (names: readonly string[] | null) =>
    (names ?? []).map((name) => name.trim()).filter(Boolean);

  aiLogger.info({ text, ...answer }, "Language model read what food a name is");

  if (answer.verdict === "not-a-food") return { verdict: "not-a-food", sure: answer.sure };
  if (answer.verdict === "several") {
    return {
      verdict: "several",
      parts: trimmed(answer.parts),
      joined: answer.joined ?? "together",
      sure: answer.sure,
    };
  }

  return {
    verdict: "food",
    englishName: answer.englishName?.trim() || null,
    generalFood: answer.generalFood?.trim() || null,
    otherNames: trimmed(answer.otherNames),
    sure: answer.sure,
  };
}

/**
 * Which of the foods the reading found the name is: the Decision, then the language model where
 * the Decision is unsure, off or failing. Null where it is none of them.
 */
async function askAbout(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution | null> {
  if (await isDecisionUseEnabled("ingredientResolution")) {
    // A Decision failure of any retryability is a warn log and the fallback.
    const decided = await decideFood(text, candidates).catch((error: unknown) => {
      aiLogger.warn(
        { err: error, feature: "ingredient-resolution", text },
        "Decision failed, falling back to the language model"
      );

      return undefined;
    });

    if (decided !== undefined) return decided;
  }

  return await askLanguageModel(text, candidates).catch((error: unknown) => {
    aiLogger.warn(
      { err: error, feature: "ingredient-resolution", text },
      "Ingredient resolution failed, flagging the Ingredient"
    );

    return failedNew(error);
  });
}

const NONE = "none";

/** One Choice over the found foods, plus none of them. The descriptions are the option set, so a Decision has no Prompt. */
function foodChoice(text: string, candidates: readonly IngredientCandidate[]) {
  const options = new Map<string, AIResolution | null>();
  const criteria: Record<string, string> = {};

  candidates.forEach((candidate, index) => {
    criteria[`same_${index + 1}`] = `Is ${candidate.name}`;
    options.set(`same_${index + 1}`, { kind: "same", ingredientId: candidate.id, sure: true });
  });
  criteria[NONE] = "Is none of these";
  options.set(NONE, null);

  return {
    state: {
      name: text,
      foods: candidates.map((candidate) => ({
        name: candidate.name,
        alsoKnownAs: candidate.aliases.slice(0, SHOWN_ALIASES),
      })),
    },
    questions: {
      food: {
        type: "choice" as const,
        instructions:
          "Which food in the catalogue is this name, if any? A name that only shares a word with a food is a different food.",
        criteria,
      },
    },
    options,
  };
}

/** The Decision over the found foods. Undefined where the pick is below the threshold: the language model's. */
async function decideFood(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution | null | undefined> {
  const { state, questions, options } = foodChoice(text, candidates);
  const { answers } = await decide({ feature: "ingredient-resolution", state, questions });
  const { choice, probabilities } = answers.food;
  const probability = probabilities[choice] ?? 0;

  aiLogger.info(
    { text, candidates: candidates.length, choice, probability },
    "Decision answered what food a name is"
  );

  return probability >= RESOLUTION_THRESHOLD ? options.get(choice) : undefined;
}

const pickSchema = z
  .object({
    food: z
      .number()
      .int()
      .nullable()
      .describe("The number of the listed food the name is; null when it is none of them."),
    sure: z.boolean(),
  })
  .strict();

/** The language model's pick among the found foods, under the administrator's Prompt. */
async function askLanguageModel(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution | null> {
  const answer = await generateStructured({
    prompt: "ingredient-resolution",
    schema: pickSchema,
    sections: [
      `Name: ${text}`,
      [
        "Foods in the catalogue it may be:",
        ...candidates.map((candidate, index) =>
          candidate.aliases.length > 0
            ? `${index + 1}. ${candidate.name} (also: ${candidate.aliases.slice(0, SHOWN_ALIASES).join(", ")})`
            : `${index + 1}. ${candidate.name}`
        ),
      ].join("\n"),
    ],
  });
  const food = answer.food === null ? undefined : candidates[answer.food - 1];

  aiLogger.info({ text, ...answer }, "Language model picked which food a name is");

  return food ? { kind: "same", ingredientId: food.id, sure: answer.sure } : null;
}
