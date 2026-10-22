/**
 * The background pass asks AI what a minted food is (ADR-0037): one reading, the code's lookup, and
 * a second question where that finds several foods or only slips. Failures are logged, not thrown.
 */
import { z } from "zod";

import type {
  IngredientCandidate,
  IngredientRef,
} from "@norish/db/repositories/ingredient-aliases";
import type { FlagReason, ReviewTrace } from "@norish/shared/contracts/ingredient-catalogue";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import {
  findIngredientCandidatesByIds,
  findSeededIngredientIds,
} from "@norish/db/repositories/ingredient-aliases";
import { findListedIngredientIds } from "@norish/db/repositories/ingredient-catalogue";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { aiLogger } from "@norish/shared-server/logger";
import { noTrace } from "@norish/shared/contracts/ingredient-catalogue";
import { distinctFoods } from "@norish/shared/lib/line-foods";

import { findOtherFoodsNamed, isExact, refOf } from "../../ingredients/resolver";
import { isCredentialRejection, isTimedOut } from "../runtime/errors";
import { decide, generateStructured } from "../runtime/runtime";

/**
 * At or above: the Decision's pick is acted on — a food it names as a known
 * one is merged into it. A wrong "same" lends one food's Product
 * Link and Aisle to another and nobody notices, where a wrong "new" is one
 * merge on the Ingredients page, so the bar is high. A named constant with a
 * test, never a setting.
 */
export const RESOLUTION_THRESHOLD = 0.8;

/**
 * How long one request to AI may take: a pass makes one per question, a split's parts included.
 * A request past it is asked once more.
 */
export const REQUEST_BUDGET_MS = 30_000;

/** How many of a candidate's other names one question shows. */
const SHOWN_ALIASES = 5;

/**
 * What rung 3 made of a name: a known food, a food of its own (flagged unless sure, filed under its
 * parent), several foods with their parts, or not a food.
 */
export type AIResolution =
  | { kind: "same"; ingredientId: string; sure: boolean }
  | { kind: "new"; kindOf: string | null; flagged: false; reason: null }
  | { kind: "new"; kindOf: string | null; flagged: true; reason: FlagReason }
  | { kind: "several"; parts: ReadPart[]; joined: LineJoin; sure: boolean }
  | { kind: "not-a-food"; sure: boolean };

/** A part of several foods as written, and the food AI's names for it found or AI picked, if any. */
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
  /** The parent's name it is filed under now, so AI judges it rather than makes one up. */
  filedUnder: string | null;
  /** Where to record what was asked, for a person who wants to know: filled in as it goes. */
  trace: ReviewTrace;
}

/** Ask what `text` is: AI reads it, and the code looks the reading up. */
export async function askWhatFoodThisIs(text: string, options: AskOptions): Promise<AIResolution> {
  if (!(await isAIEnabled())) return flaggedNew("ai-off");

  return await readThenLookUp(text, options);
}

/**
 * Requests to AI that, between them, are asked once more after the first that outlasts
 * `REQUEST_BUDGET_MS`; any other failure, or a second timeout, is thrown.
 */
export function onceMoreOnTimeout() {
  let retried = false;

  return async <T>(request: () => Promise<T>): Promise<T> => {
    try {
      return await request();
    } catch (error) {
      if (retried || !isTimedOut(error)) throw error;
      retried = true;
      aiLogger.warn({ feature: "ingredient-resolution" }, "A request timed out, asking once more");

      return await request();
    }
  };
}

/**
 * The reading, looked up: a food the names find is the one, several found are asked about; else
 * the parent AI named, else its category, found, is its parent. Flagged unless AI was sure; a slip's find never is.
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
      const found = await findNamed(
        { name: food.written, readAs: food },
        excludeId,
        namesOf(food),
        trace
      );

      if ("kind" in found) return found;
      parts.push({ text: food.written, found: found.food });
    }

    return { kind: "several", parts, joined: reading.joined, sure: true };
  }

  const [food] = reading.foods;

  Object.assign(trace, {
    englishName: food.englishName,
    parent: food.parent,
    category: food.category,
    otherNames: food.otherNames,
  });

  const found = await findNamed({ name: text, readAs: food }, excludeId, namesOf(food), trace);

  if ("kind" in found) return found;

  if (found.food) {
    return {
      kind: "same",
      ingredientId: found.food.ingredientId,
      sure: reading.sure && found.sure,
    };
  }

  let parent: { food: IngredientRef | null; sure: boolean } | null = null;

  // The parent first, the category only where the catalogue has no parent of that name.
  for (const [name, seeded] of [
    [food.parent, false],
    [food.category, true],
  ] as const) {
    if (!name) continue;
    const named = await findNamed(
      { name, readAs: { englishName: null, parent: null, category: null } },
      excludeId,
      [name],
      trace,
      { seeded }
    );

    if ("kind" in named) return named;
    parent = named;
    if (named.food) break;
  }
  const kindOf = parent?.food?.ingredientId ?? null;

  return reading.sure && found.sure && (parent?.sure ?? true)
    ? { kind: "new", kindOf, flagged: false, reason: null }
    : flaggedNew("ai-unsure", kindOf);
}

/**
 * The listed food other than `excludeId` a name AI gave finds, as any AI name is looked up
 * (`findNamed`); null where the second question got no answer.
 */
export async function findFoodNamed(
  name: string,
  excludeId: string
): Promise<{ food: IngredientRef | null } | null> {
  const found = await findNamed(
    { name, readAs: { englishName: null, parent: null, category: null } },
    excludeId,
    [name],
    noTrace()
  );

  return "kind" in found ? null : { food: found.food };
}

/** A read food's names to look up: its English name and the other names a shop sells it under. */
function namesOf(food: ReadFood): string[] {
  return [food.englishName, ...food.otherNames].filter((name) => name !== null);
}

/** A name the second question is about: as written, and what AI read it as (nulls for a parent's name). */
interface Asked {
  name: string;
  readAs: { englishName: string | null; parent: string | null; category: string | null };
}

/** A found food as the second question shows it, with the spelling of it that matched. */
type Candidate = IngredientCandidate & { matched: string };

/**
 * The listed food other than `excludeId` these names find (a seeded one where `seeded`): an exact
 * spelling wins, else several or slips alone are asked about, best first. Sure only where AI is and
 * the pick is no slip.
 */
async function findNamed(
  asked: Asked,
  excludeId: string,
  names: readonly string[],
  trace: ReviewTrace,
  { seeded = false }: { seeded?: boolean } = {}
): Promise<{ food: IngredientRef | null; sure: boolean } | AIResolution> {
  const named = (await findOtherFoodsNamed(excludeId, names)).flat();
  const ids = named.map((one) => one.ingredientId);
  // A hidden food is never AI's answer: no merge into it, no parent, no split part. A category is
  // a seeded food: an own one may be a placeholder ("toppings") whose lines leave the choice open.
  const listed = await (seeded ? findSeededIngredientIds(ids) : findListedIngredientIds(ids));
  const found = named.filter((one) => listed.has(one.ingredientId));
  const exact = found.filter(isExact);
  const ranked = distinctFoods(
    exact.length > 0 ? exact : [...found].sort((a, b) => b.score - a.score)
  );
  let pick: Pick = { ingredientId: ranked[0]?.ingredientId ?? null, sure: true };

  // One exact food is the answer; slips alone are asked about even when only one was found.
  if (ranked.length > (exact.length > 0 ? 1 : 0)) {
    const matched = new Map(ranked.map((one) => [one.ingredientId, one.matched]));
    const ids = [...matched.keys()];
    const candidates = (await findIngredientCandidatesByIds(ids))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .map((candidate) => ({ ...candidate, matched: matched.get(candidate.id) ?? candidate.name }));

    trace.considered.push(...candidates.map((candidate) => candidate.name));
    const answer = await askWhich(asked, candidates);

    if ("kind" in answer) return answer;
    pick = answer;
  }

  const picked = ranked.find((one) => one.ingredientId === pick.ingredientId);

  return {
    food: picked ? refOf(picked) : null,
    sure: pick.sure && (!picked || isExact(picked)),
  };
}

/** One food as the language model read it, its names trimmed, blanks dropped. */
interface ReadFood {
  written: string;
  englishName: string | null;
  parent: string | null;
  category: string | null;
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
        "The plain food a shopper buys that it is made of or sold as; null when there is none."
      ),
    category: z
      .string()
      .nullable()
      .describe("The general group it belongs under, such as spice or sauce; null when none."),
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
function asReading(answer: z.infer<typeof readingSchema>): Reading | null {
  const plain = (name: string | null) => name?.trim() || null;
  const foods = answer.foods.map((food) => ({
    written: food.written.trim(),
    englishName: plain(food.englishName),
    parent: plain(food.parent),
    category: plain(food.category),
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
  const sections = [`Name: ${text}`, ...(filedUnder ? [`Parent: ${filedUnder}`] : [])];
  const ask = onceMoreOnTimeout();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const answer = await ask(() =>
      generateStructured({
        prompt: "ingredient-resolution",
        schema: readingSchema,
        sections,
        timeoutMs: REQUEST_BUDGET_MS,
      })
    );
    const reading = asReading(answer);

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
  asked: Asked,
  candidates: readonly Candidate[]
): Promise<Pick | AIResolution> {
  const text = asked.name;

  if (await isDecisionUseEnabled("ingredientResolution")) {
    // A Decision failure of any retryability is a warn log and the fallback.
    const decided = await decideFood(asked, candidates).catch((error: unknown) => {
      aiLogger.warn(
        { err: error, feature: "ingredient-resolution", text },
        "Decision failed, falling back to the language model"
      );

      return null;
    });

    if (decided) return decided;
  }

  return await askLanguageModel(asked, candidates).catch((error: unknown) => {
    aiLogger.warn(
      { err: error, feature: "ingredient-resolution", text },
      "Ingredient resolution failed, flagging the Ingredient"
    );

    return failedNew(error);
  });
}

const NONE = "none";

/** Just the fields that are set. */
function present<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null)
  ) as Partial<T>;
}

/** The spelling that found a candidate, where it is not its name, and its other spellings, capped. */
function spellingsOf({ name, matched, aliases }: Candidate) {
  return {
    matched: matched === name ? null : matched,
    others: aliases.filter((alias) => alias !== matched).slice(0, SHOWN_ALIASES),
  };
}

/** One Choice over the found foods, plus none of them. The descriptions are the option set, so a Decision has no Prompt. */
function foodChoice({ name, readAs }: Asked, candidates: readonly Candidate[]) {
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
      name,
      ...present({
        englishName: readAs.englishName,
        parent: readAs.parent,
        category: readAs.category,
      }),
      foods: candidates.map((candidate) => {
        const { matched, others } = spellingsOf(candidate);

        return present({
          name: candidate.name,
          parent: candidate.parent,
          matched,
          alsoKnownAs: others,
        });
      }),
    },
    questions: {
      food: {
        type: "choice" as const,
        instructions:
          "Which food in the catalogue is this name, if any? A food's matched is its spelling that the name came close to. A name that only shares a word with a food, or is only spelled like one, is a different food.",
        criteria,
      },
    },
    options,
  };
}

/** The Decision's sure pick among the found foods; null where it is below the threshold. */
async function decideFood(asked: Asked, candidates: readonly Candidate[]): Promise<Pick | null> {
  const text = asked.name;
  const { state, questions, options } = foodChoice(asked, candidates);
  // No second Decision: one that times out falls back to the language model.
  const { answers } = await decide({
    feature: "ingredient-resolution",
    state,
    questions,
    timeoutMs: REQUEST_BUDGET_MS,
  });
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
  { name: text, readAs }: Asked,
  candidates: readonly Candidate[]
): Promise<Pick> {
  const reading = [
    readAs.englishName ? `English name: ${readAs.englishName}` : null,
    readAs.parent ? `Parent: ${readAs.parent}` : null,
    readAs.category ? `Category: ${readAs.category}` : null,
  ].filter((line) => line !== null);
  const foodLine = (candidate: Candidate, index: number) => {
    const { matched, others } = spellingsOf(candidate);
    const about = [
      candidate.parent ? `parent: ${candidate.parent}` : null,
      matched ? `matched: ${matched}` : null,
      others.length > 0 ? `also: ${others.join(", ")}` : null,
    ].filter((part) => part !== null);

    return `${index + 1}. ${candidate.name}${about.length > 0 ? ` (${about.join("; ")})` : ""}`;
  };
  const answer = await onceMoreOnTimeout()(() =>
    generateStructured({
      prompt: "ingredient-resolution",
      schema: pickSchema,
      timeoutMs: REQUEST_BUDGET_MS,
      sections: [
        `Name: ${text}`,
        ...reading,
        ["Foods in the catalogue it may be:", ...candidates.map(foodLine)].join("\n"),
      ],
    })
  );
  const food = answer.food === null ? undefined : candidates[answer.food - 1];

  aiLogger.info({ text, ...answer }, "Language model picked which food a name is");

  // A number off the list is no pick AI can be sure of.
  return food
    ? { ingredientId: food.id, sure: answer.sure }
    : { ingredientId: null, sure: answer.sure && answer.food === null };
}
