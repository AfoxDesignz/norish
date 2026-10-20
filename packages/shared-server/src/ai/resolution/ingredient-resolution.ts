/**
 * What a food a mint made is, asked of AI by the background pass (ADR-0037); an import asks
 * nothing. The candidates are the Ingredients with a word starting the way one of the name's words
 * does, and the question is whether the name is one of them, a kind of one, a food of its own,
 * several foods, or not a food at all. Two paths, in a fixed order (ADR-0035): a Decision when a
 * Decision Model is configured and this use is on, and otherwise — or when the Decision is unsure,
 * or fails — a language-model request under the administrator-editable `ingredient-resolution`
 * Prompt.
 *
 * Nothing here throws: every failure is a warn log and a flagged answer.
 */
import { z } from "zod";

import type { IngredientCandidate } from "@norish/db/repositories/ingredient-aliases";
import type { FlagReason } from "@norish/shared/contracts/ingredient-catalogue";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import {
  findIngredientCandidates,
  findIngredientsNamed,
} from "@norish/db/repositories/ingredient-aliases";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { aiLogger } from "@norish/shared-server/logger";
import { OperationTimeoutError } from "@norish/shared/lib/error-extensions";
import { foldName } from "@norish/shared/lib/fold-name";
import { withTimeout } from "@norish/shared/lib/with-timeout";

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

/** How many known foods one question considers: two options each, plus new. */
export const MAX_CANDIDATES = 20;

/** How many letters of a word the candidate search matches on: "onio" finds onion and onions. */
const WORD_START = 4;

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
  /** An Ingredient never offered as a candidate: the one the question is about. */
  excludeId: string;
  /** How long to wait for an answer before flagging the food as unanswered instead. */
  budgetMs: number;
  /** Where to record what was asked, for a person who wants to know: filled in as it goes. */
  trace: AskTrace;
}

/** What the language model read a name as, before comparing. */
interface Reading {
  englishName: string | null;
  generalFood: string | null;
  otherNames: string[];
  sure: boolean;
}

/** What one question came to: the foods the name was compared with, and what AI read the name as. */
export interface AskTrace {
  considered: string[];
  englishName: string | null;
}

/** The starts of a name's words the candidate search matches on. Numbers name no food. */
function wordStarts(text: string): string[] {
  return foldName(text)
    .split(" ")
    .filter((word) => word.length > 0 && !/^\p{N}+$/u.test(word))
    .map((word) => word.slice(0, WORD_START));
}

/** Ask what `text` is: read, then compare. Candidates are searched by `bare`, the text without its preparation. */
export async function askWhatFoodThisIs(
  text: string,
  bare: string,
  options: AskOptions
): Promise<AIResolution> {
  if (!(await isAIEnabled())) return flaggedNew("ai-off");

  const { excludeId, trace } = options;
  const found = await findIngredientCandidates(wordStarts(bare || text), MAX_CANDIDATES, excludeId);

  return withTimeout(
    () => readThenCompare(text, found, excludeId, trace),
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
 * Read first, then compare. The language model says what plain food the
 * name is, what it is a kind of and what else a shop calls it; those are
 * looked up exactly, with their parents, before what the name's own words
 * and the English name's words found. One question is then asked over all.
 * With nothing to compare even then, the reading stands: a food of its own,
 * flagged unless the model was sure.
 */
async function readThenCompare(
  text: string,
  found: readonly IngredientCandidate[],
  excludeId: string | null,
  trace: AskTrace
): Promise<AIResolution> {
  let readingError: unknown;
  const reading = await readName(text).catch((error: unknown) => {
    aiLogger.warn({ err: error, feature: "ingredient-resolution", text }, "Reading a name failed");
    readingError = error;

    return null;
  });

  trace.englishName = reading?.englishName ?? null;

  const named = await findIngredientsNamed(
    [reading?.englishName, reading?.generalFood, ...(reading?.otherNames ?? [])].map((name) =>
      foldName(name ?? "")
    ),
    excludeId
  );
  const byEnglishWords = reading?.englishName
    ? await findIngredientCandidates(wordStarts(reading.englishName), MAX_CANDIDATES, excludeId)
    : [];
  const candidates = [...named, ...found, ...byEnglishWords]
    .filter(
      (candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index
    )
    .slice(0, MAX_CANDIDATES);

  trace.considered.push(...candidates.map((candidate) => candidate.name));
  if (!reading) {
    return candidates.length > 0 ? await askAbout(text, candidates) : failedNew(readingError);
  }
  // Read as no food, it may be several or not a food: only the full question says which.
  if (candidates.length > 0 || reading.englishName === null)
    return await askAbout(text, candidates);

  return reading.sure
    ? { kind: "new", kindOf: null, flagged: false, reason: null }
    : flaggedNew("ai-unsure");
}

const readingSchema = z
  .object({
    englishName: z
      .string()
      .nullable()
      .describe("The plain English name of the food this name is; null when it is not a food."),
    generalFood: z
      .string()
      .nullable()
      .describe(
        "The more general food it is a kind of, in plain English, or null when it is not a kind of anything more general."
      ),
    otherNames: z
      .array(z.string())
      .nullable()
      .describe("Two or three other names a shop might sell this food under; null when none."),
    sure: z.boolean(),
  })
  .strict();

/** What the language model is told when it is asked only to read a name. */
function readingSections(text: string): string[] {
  return [
    `New name: ${text}`,
    "There is no list of foods yet. Say what plain food this name is (englishName), what more general food it is a kind of (generalFood), and what else a shop might call it (otherNames), so the catalogue can be searched for them.",
  ];
}

/** What the language model reads a name as, with no catalogue in front of it. */
async function readName(text: string): Promise<Reading> {
  const reading = await generateStructured({
    prompt: "ingredient-resolution",
    schema: readingSchema,
    sections: readingSections(text),
  });

  aiLogger.info({ text, ...reading }, "Language model read what food a name is");

  return {
    englishName: reading.englishName?.trim() || null,
    generalFood: reading.generalFood?.trim() || null,
    otherNames: (reading.otherNames ?? []).map((name) => name.trim()).filter(Boolean),
    sure: reading.sure,
  };
}

/**
 * The Decision, then the language model where the Decision is unsure, off or
 * failing. With nothing to compare the name with, only the language model is
 * asked.
 */
async function askAbout(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution> {
  if (candidates.length > 0 && (await isDecisionUseEnabled("ingredientResolution"))) {
    // A Decision failure of any retryability is a warn log and the fallback.
    const decided = await decideFood(text, candidates).catch((error: unknown) => {
      aiLogger.warn(
        { err: error, feature: "ingredient-resolution", text },
        "Decision failed, falling back to the language model"
      );

      return null;
    });

    if (decided) return decided;
  }

  return await askLanguageModel(text, candidates).catch((error: unknown) => {
    aiLogger.warn(
      { err: error, feature: "ingredient-resolution", text },
      "Ingredient resolution failed, flagging the Ingredient"
    );

    return failedNew(error);
  });
}

const NEW = "new";
/** Several foods need their parts named, which only the language model does: the pick defers to it. */
const SEVERAL = "several";
const NOT_A_FOOD = "not-a-food";

/**
 * One Choice over every candidate, as itself or a kind of it, plus a food of its own, several, or
 * not a food. The descriptions are the domain's own option set, so a Decision has no Prompt.
 */
function foodChoice(text: string, candidates: readonly IngredientCandidate[]) {
  const options = new Map<string, AIResolution>();
  const criteria: Record<string, string> = {};

  candidates.forEach((candidate, index) => {
    criteria[`same_${index + 1}`] = `Is ${candidate.name}`;
    options.set(`same_${index + 1}`, { kind: "same", ingredientId: candidate.id, sure: true });
    criteria[`kind_${index + 1}`] = `Is a kind of ${candidate.name}`;
    options.set(`kind_${index + 1}`, {
      kind: "new",
      kindOf: candidate.id,
      flagged: false,
      reason: null,
    });
  });
  criteria[NEW] = "Is none of these, but a food of its own";
  options.set(NEW, { kind: "new", kindOf: null, flagged: false, reason: null });
  criteria[SEVERAL] = "Names several foods at once, joined by and or or";
  criteria[NOT_A_FOOD] =
    "Is not a food: kitchen equipment the cook already has, a preparation, a fragment or a note";
  options.set(NOT_A_FOOD, { kind: "not-a-food", sure: true });

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
          "Which food in the catalogue does this name name, if any? A name that only shares a word with a food is a different food.",
        criteria,
      },
    },
    options,
  };
}

/**
 * The Decision over a name's candidates. Null where the pick is below the
 * threshold, the unclear case, or several foods: both for the language model.
 */
async function decideFood(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution | null> {
  const { state, questions, options } = foodChoice(text, candidates);
  const { answers } = await decide({ feature: "ingredient-resolution", state, questions });
  const { choice, probabilities } = answers.food;
  const probability = probabilities[choice] ?? 0;

  aiLogger.info(
    { text, candidates: candidates.length, choice, probability },
    "Decision answered what food a name is"
  );

  return probability >= RESOLUTION_THRESHOLD ? (options.get(choice) ?? null) : null;
}

const languageModelAnswerSchema = z
  .object({
    verdict: z.enum(["same", "kind-of", "new", "several", "not-a-food"]),
    food: z
      .number()
      .int()
      .nullable()
      .describe("The number of the listed food, for same and kind-of; null otherwise."),
    parts: z
      .array(z.string())
      .nullable()
      .describe("For several: each food's name, in the order written; null otherwise."),
    joined: z
      .enum(["together", "alternatives"])
      .nullable()
      .describe("For several: together when all are needed, alternatives when any one will do."),
    sure: z.boolean(),
    englishName: z
      .string()
      .nullable()
      .describe(
        "The plain English name of the food this name is, as a shopper would look for it; null when it is not a food."
      ),
  })
  .strict();

/** What the language model is told when it compares a name with the catalogue's foods. */
function comparingSections(text: string, candidates: readonly IngredientCandidate[]): string[] {
  return [
    `New name: ${text}`,
    candidates.length === 0
      ? "Foods in the catalogue: none share a word with the new name."
      : [
          "Foods in the catalogue:",
          ...candidates.map((candidate, index) =>
            candidate.aliases.length > 0
              ? `${index + 1}. ${candidate.name} (also: ${candidate.aliases.slice(0, SHOWN_ALIASES).join(", ")})`
              : `${index + 1}. ${candidate.name}`
          ),
        ].join("\n"),
  ];
}

/**
 * The language model's answer to the same question, under the administrator's
 * Prompt. It says itself whether it is sure.
 */
async function askLanguageModel(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution> {
  const answer = await generateStructured({
    prompt: "ingredient-resolution",
    schema: languageModelAnswerSchema,
    sections: comparingSections(text, candidates),
  });
  const food = answer.food === null ? undefined : candidates[answer.food - 1];

  aiLogger.info({ text, ...answer }, "Language model answered what food a name is");

  if (answer.verdict === "not-a-food") return { kind: "not-a-food", sure: answer.sure };
  if (answer.verdict === "several") {
    const parts = (answer.parts ?? []).map((part) => part.trim()).filter(Boolean);

    return parts.length > 1
      ? { kind: "several", parts, joined: answer.joined ?? "together", sure: answer.sure }
      : flaggedNew("ai-unsure");
  }
  if (answer.verdict === "same") {
    return food
      ? { kind: "same", ingredientId: food.id, sure: answer.sure }
      : flaggedNew("ai-unsure");
  }

  const kindOf = answer.verdict === "kind-of" ? (food?.id ?? null) : null;

  return answer.sure
    ? { kind: "new", kindOf, flagged: false, reason: null }
    : flaggedNew("ai-unsure", kindOf);
}
