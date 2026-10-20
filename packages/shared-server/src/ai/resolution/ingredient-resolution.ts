/**
 * Rung 3 of the ingredient resolver: what a name no alias matches is, asked
 * of AI before anything is minted (ADR-0037). The candidates are the
 * Ingredients with a word starting the way one of the name's words does, and
 * the question is whether the name is one of them, a kind of one, a food of
 * its own, several foods, a tool, or nothing at all. Two paths, in a fixed order (ADR-0035): a Decision when a
 * Decision Model is configured and this use is on, and otherwise — or when
 * the Decision is unsure, or fails — a language-model request under the
 * administrator-editable `ingredient-resolution` Prompt.
 *
 * Nothing here fails a save: every failure is a warn log and a flagged mint,
 * so an import never stops because resolution's AI did.
 */
import { z } from "zod";

import type { IngredientCandidate } from "@norish/db/repositories/ingredient-aliases";
import type { FlagReason } from "@norish/shared/contracts/ingredient-catalogue";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import {
  findIngredientCandidates,
  findIngredientCandidatesById,
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
 * At or above: the Decision's pick is acted on — a text it names as a known
 * food becomes that food's spelling. A wrong "same" lends one food's Product
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
 * is a kind of), several foods with their parts, a tool, or nothing (a Junk Line).
 */
export type AIResolution =
  | { kind: "same"; ingredientId: string; sure: boolean }
  | { kind: "new"; kindOf: string | null; flagged: false; reason: null }
  | { kind: "new"; kindOf: string | null; flagged: true; reason: FlagReason }
  | { kind: "several"; parts: string[]; joined: LineJoin; sure: boolean }
  | { kind: "tool"; sure: boolean }
  | { kind: "nothing"; sure: boolean };

/** The answers that name no food: equipment the cook already has, or nothing at all. */
export type NoFoodAnswer = "tool" | "nothing";

/** A food of its own that nothing sure vouched for: rung 4's flagged mint, and why. */
export function flaggedNew(reason: FlagReason, kindOf: string | null = null): AIResolution {
  return { kind: "new", kindOf, flagged: true, reason };
}

/** The flagged mint for a failed request: a refused key says so, so the cause is not a guess. */
function failedNew(error: unknown): AIResolution {
  return flaggedNew(isCredentialRejection(error) ? "ai-key-rejected" : "ai-unavailable");
}

/**
 * How long one name may wait on AI before it is minted flagged instead. Rung 3
 * runs inside a person's grocery add as well as an import, and a failing
 * provider retries; nothing a shopper does should hang on that. What arrives
 * after the budget is ignored.
 */
export const RESOLUTION_BUDGET_MS = 8000;

/** How a question may be asked: on the way in, or when a person asks again. */
export interface AskOptions {
  /** An Ingredient never offered as a candidate: the one the question is about. */
  excludeId?: string | null;
  /**
   * Read the name first: ask the language model what plain food it is and
   * what more general food it is a kind of ("uien" is "onion"; "cherry
   * tomatoes" are a kind of "tomato"), look both up exactly, and put those
   * foods to the question alongside what the name's own words find. An
   * import never does this — a shopper is waiting — but a person who asks
   * about a flagged food is asking for exactly this effort.
   */
  thorough?: boolean;
  /** How long to wait for an answer before minting flagged instead. */
  budgetMs?: number;
  /**
   * The food the name's own words point at (the resolver's parent from
   * words), always put to the question as a candidate. An answer that agrees
   * with it is taken as sure, and a disagreement between the language model
   * and the words is settled by the Decision where there is one.
   */
  wordsParent?: { id: string } | null;
  /** Where to record what was asked, for a person who wants to know: filled in as it goes. */
  trace?: AskTrace;
}

/** What one question came to: the foods the name was compared with, and what AI read it as. */
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

/**
 * Ask what `text` is. `bare` is the text with its preparation stripped, which
 * is what the candidates are searched by: "onions, diced" is about onions.
 * With AI switched off, or with nothing that could be the same food, nothing
 * is asked and the mint is flagged: no step vouched for it, and a translation
 * sharing no letters with its food ("ui" and "onion") is exactly what only a
 * person can catch. An answer later than `RESOLUTION_BUDGET_MS` is a flagged
 * mint too.
 */
export async function askWhatFoodThisIs(
  text: string,
  bare: string,
  options: AskOptions = {}
): Promise<AIResolution> {
  if (!(await isAIEnabled())) return flaggedNew("ai-off");

  const excludeId = options.excludeId ?? null;
  const words = options.wordsParent ?? null;
  const found = await findIngredientCandidates(wordStarts(bare || text), MAX_CANDIDATES, excludeId);
  const candidates =
    words && !found.some((candidate) => candidate.id === words.id)
      ? [...(await findIngredientCandidatesById([words.id])), ...found]
      : found;

  if (candidates.length === 0 && !options.thorough) return flaggedNew("unknown-food");

  const budgetMs = options.budgetMs ?? RESOLUTION_BUDGET_MS;
  const trace = options.trace ?? { considered: [], englishName: null };
  const asked = (
    options.thorough
      ? readThenCompare(text, candidates, excludeId, trace)
      : askAbout(text, candidates)
  ).then((answer) => settleWithWords(text, answer, words, candidates));

  if (!options.thorough) trace.considered.push(...candidates.map((candidate) => candidate.name));

  return withTimeout(() => asked, budgetMs, "Ingredient resolution").catch((error: unknown) => {
    if (!(error instanceof OperationTimeoutError)) throw error;

    aiLogger.warn(
      { feature: "ingredient-resolution", text, budgetMs },
      "Ingredient resolution ran out of time, minting a flagged Ingredient"
    );

    return flaggedNew("ai-unavailable");
  });
}

/**
 * Read first, then compare. The language model says what plain food the
 * name is, what it is a kind of and what else a shop calls it; those are
 * looked up exactly, with their parents, before what the name's own words
 * and the English name's words found. One question is then asked over all. With nothing to compare even then, the
 * reading stands: a food of its own, flagged unless the model was sure.
 */
async function readThenCompare(
  text: string,
  found: readonly IngredientCandidate[],
  excludeId: string | null,
  trace: AskTrace
): Promise<Answered> {
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
    return candidates.length > 0
      ? await askAbout(text, candidates)
      : { answer: failedNew(readingError), from: "language-model" };
  }
  // Read as no food, it may be several, a tool or nothing: only the full question says which.
  if (candidates.length > 0 || reading.englishName === null)
    return await askAbout(text, candidates);

  return {
    answer: reading.sure
      ? { kind: "new", kindOf: null, flagged: false, reason: null }
      : flaggedNew("ai-unsure"),
    from: "language-model",
  };
}

/** An answer and which path gave it: the Decision's word is final, the language model's is not. */
interface Answered {
  answer: AIResolution;
  from: "decision" | "language-model";
}

/**
 * The words' say against AI's. Where AI names the food the words point at,
 * sure or not, the two agree and the answer is sure: a kind of that food,
 * unflagged. Where the language model names another food, or none, and a
 * Decision Model is in use, the Decision has the final call between the two;
 * a pick below the threshold leaves the language model's answer as it was.
 * Without a Decision Model AI's answer stands. A Decision's own answer is
 * never second-guessed: it saw the words' food among its options.
 */
async function settleWithWords(
  text: string,
  { answer, from }: Answered,
  words: { id: string } | null,
  candidates: readonly IngredientCandidate[]
): Promise<AIResolution> {
  if (!words || (answer.kind !== "same" && answer.kind !== "new")) return answer;
  if (answer.kind === "same") {
    if (answer.sure) return answer;

    // An unsure "same" is weighed against the words as an unsure food of its own.
    return settleWithWords(text, { answer: flaggedNew("ai-unsure"), from }, words, candidates);
  }
  if (answer.kindOf === words.id)
    return { kind: "new", kindOf: words.id, flagged: false, reason: null };
  if (from === "decision" || !(await isDecisionUseEnabled("ingredientResolution"))) return answer;

  const wordsFood = candidates.find((candidate) => candidate.id === words.id);
  const aiFood = answer.kindOf
    ? candidates.find((candidate) => candidate.id === answer.kindOf)
    : null;

  if (!wordsFood || (answer.kindOf && !aiFood)) return answer;

  const settled = await decideBetween(text, wordsFood, aiFood ?? null).catch((error: unknown) => {
    aiLogger.warn(
      { err: error, feature: "ingredient-resolution", text },
      "Decision between the words' food and the language model's failed"
    );

    return null;
  });

  return settled ?? answer;
}

/**
 * One two-way Choice: a kind of the words' food, or what the language model
 * said (a kind of another food, or a food of its own). Null below the
 * threshold.
 */
async function decideBetween(
  text: string,
  wordsFood: IngredientCandidate,
  aiFood: IngredientCandidate | null
): Promise<AIResolution | null> {
  const criteria = {
    words: `Is a kind of ${wordsFood.name}`,
    ai: aiFood ? `Is a kind of ${aiFood.name}` : "Is none of these, but a food of its own",
  };
  const { answers } = await decide({
    feature: "ingredient-resolution",
    state: {
      name: text,
      foods: [wordsFood, ...(aiFood ? [aiFood] : [])].map((candidate) => ({
        name: candidate.name,
        alsoKnownAs: candidate.aliases.slice(0, SHOWN_ALIASES),
      })),
    },
    questions: {
      food: {
        type: "choice",
        instructions:
          "The name's own words say it is a kind of the first food; a language model read it otherwise. Which is right?",
        criteria,
      },
    },
  });
  const { choice, probabilities } = answers.food;
  const probability = probabilities[choice] ?? 0;

  aiLogger.info(
    { text, words: wordsFood.name, ai: aiFood?.name ?? null, choice, probability },
    "Decision settled the words' food against the language model's"
  );

  if (probability < RESOLUTION_THRESHOLD) return null;

  return {
    kind: "new",
    kindOf: choice === "words" ? wordsFood.id : (aiFood?.id ?? null),
    flagged: false,
    reason: null,
  };
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
): Promise<Answered> {
  if (candidates.length > 0 && (await isDecisionUseEnabled("ingredientResolution"))) {
    // A Decision failure of any retryability is a warn log and the fallback.
    const decided = await decideFood(text, candidates).catch((error: unknown) => {
      aiLogger.warn(
        { err: error, feature: "ingredient-resolution", text },
        "Decision failed, falling back to the language model"
      );

      return null;
    });

    if (decided) return { answer: decided, from: "decision" };
  }

  const answer = await askLanguageModel(text, candidates).catch((error: unknown) => {
    aiLogger.warn(
      { err: error, feature: "ingredient-resolution", text },
      "Ingredient resolution failed, minting a flagged Ingredient"
    );

    return failedNew(error);
  });

  return { answer, from: "language-model" };
}

const NEW = "new";
/** Several foods need their parts named, which only the language model does: the pick defers to it. */
const SEVERAL = "several";
const TOOL = "tool";
const NOTHING = "nothing";

/**
 * One Choice over every candidate, as itself or a kind of it, plus a food of its own, several, a tool
 * or nothing. The descriptions are the domain's own option set, so a Decision has no Prompt.
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
  criteria[TOOL] = "Is kitchen equipment the cook already has, such as a tin or a rolling pin";
  options.set(TOOL, { kind: "tool", sure: true });
  criteria[NOTHING] = "Names nothing to buy or use: a preparation, a fragment or a note";
  options.set(NOTHING, { kind: "nothing", sure: true });

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
    verdict: z.enum(["same", "kind-of", "new", "several", "tool", "nothing"]),
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

  if (answer.verdict === "tool" || answer.verdict === "nothing") {
    return { kind: answer.verdict, sure: answer.sure };
  }
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
