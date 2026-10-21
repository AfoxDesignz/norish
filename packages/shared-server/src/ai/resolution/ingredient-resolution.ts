/**
 * What a food a mint made is, asked of AI by the background pass (ADR-0037); an import asks
 * nothing. One language-model request under the administrator-editable `ingredient-resolution`
 * Prompt reads the name and the parent it is filed under, with no catalogue in front of it: a food
 * (its plain English name, the plain food it is made of or sold as, and other names a shop sells it
 * under), several foods, or not a food. The answer's shape is checked, and asked once more where it breaks. The code looks the
 * names up as an import would, a split's parts too. Only where they name more than one food, or
 * only foods a slip of the fingers away, is a second question asked over just those: a Decision when a Decision Model is configured and this
 * use is on, and otherwise — or when the Decision is unsure, or fails — the language model
 * (ADR-0035).
 *
 * Nothing here throws: every failure is a warn log and a flagged answer.
 */
import { z } from "zod";

import type {
  IngredientCandidate,
  IngredientRef,
} from "@norish/db/repositories/ingredient-aliases";
import type { FlagReason, ReviewTrace } from "@norish/shared/contracts/ingredient-catalogue";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import { findIngredientCandidatesByIds } from "@norish/db/repositories/ingredient-aliases";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { aiLogger } from "@norish/shared-server/logger";
import { OperationTimeoutError } from "@norish/shared/lib/error-extensions";
import { onlyNearest } from "@norish/shared/lib/name-slips";
import { withTimeout } from "@norish/shared/lib/with-timeout";

import { findOtherFoodsNamed, refOf } from "../../ingredients/resolver";
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
  | { kind: "several"; parts: ReadPart[]; joined: LineJoin; sure: boolean }
  | { kind: "not-a-food"; sure: boolean };

/** A part of several foods as written, and the food AI's names for it surely found, if any. */
export interface ReadPart {
  text: string;
  found: IngredientRef | null;
}

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
  /** The name of the parent it is filed under now, shown so AI judges it rather than makes one up. */
  filedUnder: string | null;
  /** How long to wait for an answer before flagging the food as unanswered instead. */
  budgetMs: number;
  /** Where to record what was asked, for a person who wants to know: filled in as it goes. */
  trace: ReviewTrace;
}

/** Ask what `text` is: AI reads it, and the code looks the reading up. */
export async function askWhatFoodThisIs(text: string, options: AskOptions): Promise<AIResolution> {
  if (!(await isAIEnabled())) return flaggedNew("ai-off");

  return withTimeout(
    () => readThenLookUp(text, options),
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
 * The reading, looked up: a food the names find is the one, several found are asked about; else
 * the parent AI named, found, is its parent. Flagged unless AI was sure; a slip's find never is.
 */
async function readThenLookUp(
  text: string,
  { excludeId, filedUnder, trace }: AskOptions
): Promise<AIResolution> {
  let reading: Reading | null;

  try {
    reading = await readName(text, filedUnder);
  } catch (error) {
    aiLogger.warn({ err: error, feature: "ingredient-resolution", text }, "Reading a name failed");

    return failedNew(error);
  }

  if (!reading) return flaggedNew("ai-unavailable");
  if (reading.kind === "not-a-food") return { kind: "not-a-food", sure: reading.sure };
  if (reading.kind === "several") {
    trace.parts = reading.foods.map((food) => food.written);
    if (!reading.sure) return { kind: "several", parts: [], joined: reading.joined, sure: false };

    const parts: ReadPart[] = [];

    for (const food of reading.foods) {
      const found = await findNamed(food.written, excludeId, food, trace);

      if ("kind" in found) return found;
      parts.push({ text: food.written, found: found.sure ? found.food : null });
    }

    return { kind: "several", parts, joined: reading.joined, sure: true };
  }

  const [food] = reading.foods;

  Object.assign(trace, {
    englishName: food.englishName,
    parent: food.parent,
    otherNames: food.otherNames,
  });

  const found = await findNamed(text, excludeId, food, trace);

  if ("kind" in found) return found;
  const sure = reading.sure && found.sure;

  if (found.food) return { kind: "same", ingredientId: found.food.ingredientId, sure };

  const [general] = food.parent ? await findOtherFoodsNamed(excludeId, [food.parent]) : [];
  const parent = onlyNearest(general ?? []);
  const kindOf = parent?.ingredientId ?? null;

  return sure && (parent?.score ?? 1) === 1
    ? { kind: "new", kindOf, flagged: false, reason: null }
    : flaggedNew("ai-unsure", kindOf);
}

/**
 * The food other than `excludeId` a read food's names find: an exact spelling is taken, slips
 * beside it ignored. Several, or slips alone, are asked about, best first. Not sure where AI was
 * not, or a slip of AI's names found it (cherry beside sherry).
 */
async function findNamed(
  text: string,
  excludeId: string,
  food: ReadFood,
  trace: ReviewTrace
): Promise<{ food: IngredientRef | null; sure: boolean } | AIResolution> {
  const names = [food.englishName, ...food.otherNames].filter((name) => name !== null);
  const found = (await findOtherFoodsNamed(excludeId, names)).flat();
  const exact = found.filter((one) => one.score === 1);
  const ranked = (exact.length > 0 ? exact : [...found].sort((a, b) => b.score - a.score)).filter(
    (one, index, all) => all.findIndex((other) => other.ingredientId === one.ingredientId) === index
  );
  let pick: Pick = { ingredientId: ranked[0]?.ingredientId ?? null, sure: true };

  // One exact food is the answer; slips alone are asked about even when only one was found.
  if (ranked.length > (exact.length > 0 ? 1 : 0)) {
    const ids = ranked.map((one) => one.ingredientId);
    const candidates = (await findIngredientCandidatesByIds(ids)).sort(
      (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)
    );

    trace.considered.push(...candidates.map((candidate) => candidate.name));
    const asked = await askWhich(text, candidates);

    if ("kind" in asked) return asked;
    pick = asked;
  }

  const hit = ranked.find((one) => one.ingredientId === pick.ingredientId);

  return {
    food: hit ? refOf(hit) : null,
    sure: pick.sure && (hit?.score ?? 1) === 1,
  };
}

/** One food as the language model read it, its names trimmed, blanks dropped. */
interface ReadFood {
  written: string;
  englishName: string | null;
  parent: string | null;
  otherNames: string[];
}

/** What the language model read a name as, its shape checked. */
type Reading =
  | { kind: "food"; foods: [ReadFood]; sure: boolean }
  | { kind: "several"; foods: ReadFood[]; joined: LineJoin; sure: boolean }
  | { kind: "not-a-food"; sure: boolean };

const readFoodSchema = z
  .object({
    written: z.string().describe("The food as the name writes it, in the language written."),
    englishName: z.string().describe("Its plain English name, as a shopper would look for it."),
    parent: z
      .string()
      .nullable()
      .describe(
        "The plain food a shopper buys that it is made of or sold as, never a category; null when there is none."
      ),
    otherNames: z
      .array(z.string())
      .nullable()
      .describe("Two or three other names a shop might sell it under; null when none."),
  })
  .strict();

/** One flat object, since OpenAI's strict mode refuses a choice of schemas at the top. */
const readingSchema = z
  .object({
    sure: z.boolean(),
    action: z
      .object({
        kind: z.enum(["food", "several", "not-a-food"]),
        joined: z
          .enum(["together", "alternatives"])
          .nullable()
          .describe(
            "For several: together when all are needed, alternatives when any one will do."
          ),
        reason: z
          .enum(["equipment", "preparation", "note", "gibberish"])
          .nullable()
          .describe("For not-a-food: what the name is instead."),
      })
      .strict(),
    foods: z
      .array(readFoodSchema)
      .describe("One entry for food, one per food for several, none for not-a-food."),
  })
  .strict();

/**
 * The answer as a reading, or null where its shape breaks: a food has one entry, several have two
 * or more and a join, not a food has none and a reason.
 */
function checked(answer: z.infer<typeof readingSchema>): Reading | null {
  const plain = (name: string | null) => name?.trim() || null;
  const foods = answer.foods.map((food) => ({
    written: food.written.trim(),
    englishName: plain(food.englishName),
    parent: plain(food.parent),
    otherNames: (food.otherNames ?? []).map(plain).filter((name) => name !== null),
  }));
  const { kind, joined, reason } = answer.action;
  const [first, ...rest] = foods;

  if (kind === "food" && first && rest.length === 0) {
    return { kind, foods: [first], sure: answer.sure };
  }
  if (kind === "several" && foods.length > 1 && joined) {
    return { kind, foods, joined, sure: answer.sure };
  }
  if (kind === "not-a-food" && foods.length === 0 && reason) return { kind, sure: answer.sure };

  return null;
}

/** What the language model reads a name as, asked once more where the answer breaks its shape. */
async function readName(text: string, filedUnder: string | null): Promise<Reading | null> {
  const sections = [`Name: ${text}`, ...(filedUnder ? [`Filed under: ${filedUnder}`] : [])];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const answer = await generateStructured({
      prompt: "ingredient-resolution",
      schema: readingSchema,
      sections,
    });
    const reading = checked(answer);

    aiLogger.info({ text, attempt, ...answer }, "Language model read what food a name is");
    if (reading) return reading;
    aiLogger.warn(
      { feature: "ingredient-resolution", text, attempt },
      "The reading broke its shape"
    );
  }

  return null;
}

/** Which of the found foods the name is, or none (null), and whether AI was sure. */
interface Pick {
  ingredientId: string | null;
  sure: boolean;
}

/**
 * The Decision, then the language model where the Decision is below its threshold, off or failing.
 * A failed language model is a flagged answer.
 */
async function askWhich(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<Pick | AIResolution> {
  if (await isDecisionUseEnabled("ingredientResolution")) {
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

const NONE = "none";

/** One Choice over the found foods, plus none of them. The descriptions are the option set, so a Decision has no Prompt. */
function foodChoice(text: string, candidates: readonly IngredientCandidate[]) {
  const options = new Map<string, string | null>();
  const criteria: Record<string, string> = {};

  candidates.forEach((candidate, index) => {
    criteria[`same_${index + 1}`] = `Is ${candidate.name}`;
    options.set(`same_${index + 1}`, candidate.id);
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

/** The Decision's sure pick among the found foods; null where it is below the threshold. */
async function decideFood(
  text: string,
  candidates: readonly IngredientCandidate[]
): Promise<Pick | null> {
  const { state, questions, options } = foodChoice(text, candidates);
  const { answers } = await decide({ feature: "ingredient-resolution", state, questions });
  const { choice, probabilities } = answers.food;
  const probability = probabilities[choice] ?? 0;

  aiLogger.info(
    { text, candidates: candidates.length, choice, probability },
    "Decision answered what food a name is"
  );

  if (probability < RESOLUTION_THRESHOLD || !options.has(choice)) return null;

  return { ingredientId: options.get(choice) ?? null, sure: true };
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
): Promise<Pick> {
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

  // A number off the list is no pick AI can be sure of.
  return food
    ? { ingredientId: food.id, sure: answer.sure }
    : { ingredientId: null, sure: answer.sure && answer.food === null };
}
