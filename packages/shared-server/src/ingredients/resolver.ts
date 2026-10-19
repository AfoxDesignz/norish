import type {
  IngredientAliasRow,
  IngredientRef,
  IngredientRow,
} from "@norish/db/repositories/ingredient-aliases";
import type { LineResolution } from "@norish/db/repositories/ingredients";
import type { FlagReason } from "@norish/shared/contracts/ingredient-catalogue";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import type { JoinedParts, SpellingKeys, SpellingRules } from "@norish/shared/lib/spelling-keys";
import { isStaleIngredientReference } from "@norish/db/repositories/constraint-violation";
import {
  addIngredientAliases,
  findIngredientAliasesByFolds,
  findIngredientByAliasId,
  findSeededFoodSpellingsByFolds,
  mintIngredientWithAliases,
} from "@norish/db/repositories/ingredient-aliases";
import { getIngredientWords, getUnits } from "@norish/shared-server/config/server-config-loader";
import { dbLogger } from "@norish/shared-server/logger";
import { stripHtmlTags } from "@norish/shared/lib/helpers";
import { catalogueLanguagesFor } from "@norish/shared/lib/ingredient-names";
import { namesNoFood } from "@norish/shared/lib/ingredient-text";
import {
  inflectedReadings,
  joinedParts,
  spellingKeys,
  spellingRules,
} from "@norish/shared/lib/spelling-keys";

import type { AIResolution } from "../ai/resolution/ingredient-resolution";
import { askWhatFoodThisIs, flaggedNew } from "../ai/resolution/ingredient-resolution";
import { announceMinted } from "./minted";

/**
 * The ingredient resolver: the one module that mints Ingredients and
 * Ingredient Aliases (ADR-0037). Every path that stores a name for a food — a
 * recipe line, a Pantry Ingredient, a Grocery, a recurring grocery — hands its
 * text as written here and stores the alias that comes back; the text itself
 * is kept by the caller and shown as written.
 *
 * The resolution order for one text, read without its stray marks, prices
 * and notes (`cleanSpelling`), where one that names no food stops at once:
 *   1. an alias whose fold is the text's fold;
 *   2. an alias whose fold is the text's with preparation stripped — the part
 *      after the first comma and anything in brackets ("onions, diced" and
 *      "onions (red)" are "onions") — else with a phrase of the units map at
 *      either end, a container, weight or volume at the start and
 *      preparation words at either end stripped too ("salt to taste", "a
 *      pinch of nutmeg", "naar smaak zout", "can of chickpeas drained and
 *      rinsed", "GR CHERRYTOMATEN" and "garlic cloves crushed" are salt,
 *      nutmeg, zout, chickpeas, CHERRYTOMATEN and garlic cloves);
 *   (both keys are `@norish/shared/lib/spelling-keys`, which the clients
 *   match unresolved text on too);
 *   a recipe line neither rung knows whole is then the foods its joining
 *   words split it into, all known ("zout en peper": `resolveLineFoods`);
 *   3. what AI makes of it (`ai/resolution/ingredient-resolution`): a Decision, or the language
 *      model — a known food it is sure the text names takes the text's
 *      clean spelling, so the next occurrence is a rung-1 or rung-2 match;
 *   4. a new Ingredient under the food AI said it is a kind of, if any.
 *
 * A mint or a join gives the food only the text's clean spelling, its plain
 * name else its bare one, never the text as written (ADR-0037).
 *
 * A mint that no sure AI answer vouched for is flagged, so a person can merge
 * it or mark it distinct. One AI placed nowhere is filed under the longest
 * seeded spelling its words contain, as whole words, and stays flagged: a
 * guess from words may set a parent, never merge (ADR-0037 as amended by
 * ADR-0039). The spelling its text ends with ("ground cumin" under cumin) is
 * filed quietly; one found anywhere else in the words ("garlic cloves" under
 * garlic, "kale large stalks removed" under kale) is filed with a suggestion
 * beside it, for a person to confirm or dismiss.
 */

/**
 * Which rules the first two rungs and the parent from words follow. Raised
 * whenever they change, so the startup pass looks at old Flagged Ingredients
 * again under the new rules (`recheckUndecidedMints`). 3: the ingredient
 * words of every language, plurals and diminutives at rung 2, and a
 * quantity left at a name's start. 4: a social media mention names no food.
 * 5: a weight or a volume at a name's start, with or without its number.
 * 6: a joining word left at a name's start ("di farina"). 7: stray marks,
 * doubled brackets, prices and notes are no part of a name ("baking soda )").
 */
export const RUNG_VERSION = 7;

/** Who the resolution is for: the owner of anything it mints. */
export interface ResolveActor {
  userId: string | null;
  /** The language the text is in, where the caller knows it. */
  locale?: string | null;
}

export interface ResolveOptions {
  /** Whether rung 3 may be asked; off, a name nothing else knows is minted flagged. */
  ai?: boolean;
}

/** How many names one call asks AI about at once. */
const AI_CONCURRENCY = 4;

/** One text as written, and the alias and Ingredient it resolved to. */
export interface ResolvedIngredient extends IngredientRef {
  text: string;
}

/**
 * A text as the first two rungs read it: as written, its keys (clean, its
 * fold, its folds with the preparation stripped), the other readings of its
 * plain name as the same food (its plurals and diminutives), and the rules
 * it was read by.
 */
interface Spelling extends SpellingKeys {
  text: string;
  inflected: string[];
  rules: SpellingRules;
}

function spellingOf(text: string, rules: SpellingRules): Spelling {
  const keys = spellingKeys(text, rules);

  return {
    text,
    ...keys,
    inflected: inflectedReadings(keys.plainFold || keys.bareFold || keys.fold, rules, true),
    rules,
  };
}

/** How long built rules are reused: a pass over an instance's history asks thousands of times a minute. */
const RULES_TTL_MS = 10_000;

let builtRules: { at: number; rules: Promise<SpellingRules> } | null = null;

/**
 * The rules rung 2 reads a name by: the administrator's units map and
 * ingredient words, built at most once every few seconds, so an edit lands
 * almost at once and an upgrade's thousands of names don't rebuild them each.
 */
/** Read the units map and the ingredient words afresh next time: an administrator just changed one. */
export function forgetSpellingRules(): void {
  builtRules = null;
}

async function currentRules(): Promise<SpellingRules> {
  const now = Date.now();

  if (!builtRules || now - builtRules.at > RULES_TTL_MS) {
    const rules = Promise.all([getUnits(), getIngredientWords()]).then(([units, words]) =>
      spellingRules(units, words)
    );

    builtRules = { at: now, rules };
    // A failed read is not kept: the next call reads again.
    rules.catch(() => {
      if (builtRules?.rules === rules) builtRules = null;
    });
  }

  return await builtRules.rules;
}

/** The aliases Norish already has for these spellings, by fold, in one query. */
async function knownAliases(
  spellings: readonly Spelling[]
): Promise<Map<string, IngredientAliasRow>> {
  const rows = await findIngredientAliasesByFolds(
    spellings.flatMap((spelling) => [
      spelling.fold,
      spelling.bareFold,
      spelling.plainFold,
      ...spelling.inflected,
    ])
  );

  return new Map(rows.map((row) => [row.fold, row]));
}

/**
 * Rungs 1 and 2: the alias with the text's fold, else the one with its
 * preparation stripped, else the one with the units map's phrases and the
 * ingredient words stripped too, else one its plain name is a plural or a
 * diminutive of, or the reverse ("bosuien" and "bosuitjes" are "bosui").
 */
function matchKnown(
  spelling: Spelling,
  known: ReadonlyMap<string, IngredientAliasRow>
): IngredientAliasRow | undefined {
  return (
    known.get(spelling.fold) ??
    (spelling.bareFold ? known.get(spelling.bareFold) : undefined) ??
    (spelling.plainFold ? known.get(spelling.plainFold) : undefined) ??
    spelling.inflected.map((reading) => known.get(reading)).find((row) => row !== undefined)
  );
}

/** The as-written text a caller hands in, cleaned the way every stored name is. */
export function cleanIngredientText(text: string): string {
  return stripHtmlTags(text).replace(/\s+/g, " ").trim();
}

/** Whether a text names no food as written or once cleaned (`namesNoFood`): markup alone, ")", "($0.02)". */
function spellingNamesNoFood(spelling: Spelling): boolean {
  return namesNoFood(spelling.text) || namesNoFood(spelling.clean);
}

/**
 * Resolve texts as written to aliases, one per text and in the same order,
 * null for a text that names no food. Texts that resolve alike share their
 * answer, so one recipe that says "onions" twice mints one Ingredient.
 */
export async function resolveIngredients(
  texts: readonly string[],
  actor: ResolveActor,
  options: ResolveOptions = {}
): Promise<Array<ResolvedIngredient | null>> {
  const resolved = await resolveTexts(texts, actor, options, { splitJoined: false });

  return resolved.map((one) => (one ? { text: one.text, ...one.foods[0]! } : null));
}

/** One text as written, and the foods it names in order, with how several go together. */
export interface ResolvedFoods extends LineResolution {
  text: string;
}

/**
 * Resolve recipe lines' texts as `resolveIngredients` does, except that a text not known whole
 * whose words join known foods ("zout en peper", "boter of olie") names each of them.
 */
export async function resolveLineFoods(
  texts: readonly string[],
  actor: ResolveActor,
  options: ResolveOptions = {}
): Promise<Array<ResolvedFoods | null>> {
  return await resolveTexts(texts, actor, options, { splitJoined: true });
}

/**
 * Each row once per food its name's words join, minting nothing: "zout en peper" a row each,
 * alternatives ("boter of olie") the first or each. The first keeps the row's id (ADR-0003).
 */
export async function typedParts<T extends { id?: string | null; name: string | null }>(
  rows: readonly T[],
  { alternatives }: { alternatives: "first" | "each" }
): Promise<Array<[T, ...T[]]>> {
  const rules = await currentRules();
  const read = rows.map((row) => ({
    row,
    spelling: spellingOf(cleanIngredientText(row.name ?? ""), rules),
  }));
  const { byWords } = await readByWords(
    read.map(({ spelling }) => spelling),
    rules,
    true
  );

  return read.map(({ row, spelling }) => {
    const named = byWords.get(spelling);
    const [first, ...rest] = named?.joined ? named.foods.map((food) => food.text) : [];

    if (first === undefined) return [row];

    const others = named?.joined === "together" || alternatives === "each" ? rest : [];

    return [{ ...row, name: first }, ...others.map((name) => ({ ...row, id: undefined, name }))];
  });
}

/** A text split at its joining words (`joinedParts`), each part read as a spelling. */
interface SpelledParts extends JoinedParts {
  spellings: Spelling[];
}

/**
 * The foods a text's joining words split it into, each with the part naming it, where the first two
 * rungs know every part; parts that are one food name it alone. Undefined where they name no foods.
 */
function foodsByWords(
  parts: SpelledParts,
  known: ReadonlyMap<string, IngredientAliasRow>
): { foods: ResolvedIngredient[]; joined: LineJoin | null } | undefined {
  const aliases = parts.spellings.map((part) => matchKnown(part, known));

  if (!aliases.every((alias) => alias !== undefined)) return undefined;

  // A word that joins a measure somewhere ("of") splits no name whose every part is spelled there.
  const spelledIn = (languages: ReadonlySet<string>) => (alias: IngredientAliasRow) =>
    alias.locale !== null && catalogueLanguagesFor(alias.locale).every((l) => languages.has(l));

  if (parts.words.some((word) => aliases.every(spelledIn(word.connectorIn)))) return undefined;

  const foods = aliases.flatMap(({ aliasId, ingredientId }, index) =>
    aliases.findIndex((other) => other.ingredientId === ingredientId) === index
      ? [{ aliasId, ingredientId, text: parts.parts[index]! }]
      : []
  );

  return { foods, joined: foods.length > 1 ? parts.joined : null };
}

/**
 * The aliases spellings and, with `splitJoined`, their joined parts match, and the foods the words
 * name for each spelling not known whole. One query; mints nothing.
 */
async function readByWords(
  asWritten: readonly Spelling[],
  rules: SpellingRules,
  splitJoined: boolean
) {
  const spellings = asWritten.filter((spelling) => !spellingNamesNoFood(spelling));
  const splits = new Map(
    (splitJoined ? spellings : []).flatMap((spelling) => {
      const found = joinedParts(spelling.clean, rules);
      const spelled = found && {
        ...found,
        spellings: found.parts.map((p) => spellingOf(p, rules)),
      };

      return spelled ? [[spelling, spelled] as const] : [];
    })
  );
  const known = await knownAliases([
    ...spellings,
    ...[...splits.values()].flatMap((found) => found.spellings),
  ]);
  const byWords = new Map(
    [...splits].flatMap(([spelling, found]) => {
      const foods = matchKnown(spelling, known) ? undefined : foodsByWords(found, known);

      return foods ? [[spelling, foods] as const] : [];
    })
  );

  return { spellings, known, byWords };
}

/** Both resolutions: `splitJoined` reads a text not known whole by its joining words before AI. */
async function resolveTexts(
  texts: readonly string[],
  actor: ResolveActor,
  options: ResolveOptions,
  { splitJoined }: { splitJoined: boolean }
): Promise<Array<ResolvedFoods | null>> {
  const rules = await currentRules();
  const asWritten = texts.map((text) => spellingOf(cleanIngredientText(text), rules));
  const { spellings, known, byWords } = await readByWords(asWritten, rules, splitJoined);
  const answers = await askAboutUnknown(
    spellings.filter((spelling) => !matchKnown(spelling, known) && !byWords.has(spelling)),
    options
  );
  const resolved = new Map<Spelling, ResolvedFoods>();
  const minted = new Set<string>();

  for (const spelling of spellings) {
    const named = byWords.get(spelling);

    if (named) {
      resolved.set(spelling, {
        text: spelling.text,
        foods: named.foods.map(({ aliasId, ingredientId }) => ({ aliasId, ingredientId })),
        joined: named.joined,
      });
      continue;
    }

    const match = matchKnown(spelling, known);

    if (!match) {
      // No answer means AI was not asked: the name is minted flagged.
      const asked = answers.get(sameFoodKey(spelling));
      const answer = asked?.answer ?? flaggedNew("upgrade");
      const wordsParent = async () => (asked ? asked.words : await parentFromWords(spelling));
      // The food AI named may have been merged away since the question was
      // asked; the text is then minted flagged rather than failing its save.
      const joined =
        answer.kind === "same"
          ? await addIngredientAliases({
              ingredientId: answer.ingredientId,
              aliases: [cleanAlias(spelling)],
              ownerId: actor.userId,
              locale: actor.locale ?? null,
            })
          : null;
      const rows =
        joined ??
        (answer.kind === "same"
          ? await mint(spelling, actor, {
              flagReason: "food-gone",
              parent: await wordsParent(),
            })
          : await mint(spelling, actor, {
              flagReason: answer.reason,
              parent: answer.kindOf
                ? { id: answer.kindOf, sure: true }
                : answer.reason !== null
                  ? await wordsParent()
                  : null,
            }));

      for (const row of rows) known.set(row.fold, row);
      if (!joined) for (const row of rows) minted.add(row.ingredientId);
    }

    const alias = match ?? matchKnown(spelling, known)!;

    resolved.set(spelling, {
      text: spelling.text,
      foods: [{ aliasId: alias.aliasId, ingredientId: alias.ingredientId }],
      joined: null,
    });
  }

  // What the administrator turned on for new foods follows someone's action, never a pass with AI off.
  if (options.ai !== false) await announceMinted([...minted]);

  return asWritten.map((spelling) => resolved.get(spelling) ?? null);
}

/** Spellings the first two rungs resolve alike: "onions, diced" and "onions (2)" are one question (`foodKey`). */
function sameFoodKey(spelling: Spelling): string {
  return spelling.bareFold || spelling.fold;
}

/** What rung 3 made of one spelling, with the food its words pointed at, which the question was told. */
interface Asked {
  answer: AIResolution;
  words: ParentFromWords | null;
}

/**
 * Rung 3 for every spelling the first two rungs did not know, asked once per
 * food the spellings name and a few at a time, by the key `sameFoodKey` gives.
 * Each question is told the food the spelling's words point at, so AI and
 * the words are weighed together (`settleWithWords`).
 */
async function askAboutUnknown(
  unknown: readonly Spelling[],
  options: ResolveOptions
): Promise<Map<string, Asked>> {
  const questions = new Map(unknown.map((spelling) => [sameFoodKey(spelling), spelling]));
  const answers = new Map<string, Asked>();

  if (options.ai === false) return answers;

  const pending = [...questions.entries()];

  while (pending.length > 0) {
    const batch = pending.splice(0, AI_CONCURRENCY);
    const answered = await Promise.all(
      batch.map(async ([, spelling]) => {
        const words = await parentFromWords(spelling);
        const answer = await askWhatFoodThisIs(spelling.clean, spelling.bare, {
          wordsParent: words,
        });

        return { answer, words };
      })
    );

    batch.forEach(([key], index) => answers.set(key, answered[index]!));
  }

  return answers;
}

/**
 * Resolve one text as written, or answer null where it names no food. For
 * the callers that take a single name from a person.
 */
export async function resolveIngredient(
  text: string,
  actor: ResolveActor,
  options: ResolveOptions = {}
): Promise<ResolvedIngredient | null> {
  const [resolved] = await resolveIngredients([text], actor, options);

  return resolved ?? null;
}

/**
 * Rung 4. The Ingredient is named for its clean spelling, which is its one
 * alias, so "onions, diced" first and "onions" or "onions, sliced" later are
 * the one food. Flagged unless a sure AI answer said it is a food of its own;
 * placed under the food AI said it is a kind of, where it said so, else under
 * the one its words suggest, with a suggestion to confirm where that was a
 * guess from inside the words.
 */
async function mint(
  spelling: Spelling,
  actor: ResolveActor,
  { flagReason, parent }: { flagReason: FlagReason | null; parent: ParentFromWords | null }
): Promise<IngredientAliasRow[]> {
  const alias = cleanAlias(spelling);

  return await mintIngredientWithAliases({
    name: alias.text,
    aliases: [alias],
    ownerId: actor.userId,
    locale: actor.locale ?? null,
    flagged: flagReason !== null,
    flagReason,
    parentId: parent?.id ?? null,
    suggestParent: parent !== null && !parent.sure,
  });
}

/**
 * A parent found in the words of a text: `sure` where the text ends with the
 * parent's spelling, the food named last in most languages ("ground cumin"),
 * and not where the spelling sits elsewhere in the words ("garlic cloves
 * crushed" under garlic), which a person is asked to confirm.
 */
export interface ParentFromWords {
  id: string;
  sure: boolean;
}

/**
 * The parent a flagged mint is filed under from the words of its text: the
 * longest spelling of a seeded food the text, stripped as rung 2 strips it,
 * contains as whole words and is longer than ("verse peterselie" under
 * peterselie, "smoked sweet paprika" under sweet paprika, "garlic cloves"
 * under garlic), or none. Of two the same length, the one the text ends
 * with. Only the words before an "in", "met" or "with" are read, and those
 * may name the parent whole ("sardines in water" under sardine); a word of
 * recipe language alone ("and", "more") names none. Where the words end in
 * a plural, its singular is read too, the whole text included ("carrots"
 * under carrot, "red bell peppers" under red bell pepper): the plural stays
 * a food of its own, for AI or a person to merge.
 */
async function parentFromWords(spelling: Spelling): Promise<ParentFromWords | null> {
  const { rules } = spelling;
  const all = (spelling.plainFold || spelling.bareFold || spelling.fold).split(" ");
  const cut = all.findIndex((word, index) => index > 0 && rules.servedWith.has(word));
  const words = cut > 0 ? all.slice(0, cut) : all;
  const windows: Array<{ fold: string; sure: boolean }> = [];

  // Longest first; within a length, the words as written from the end of the
  // text backwards, then the last of them read in the singular, since the
  // food is named last ("dried guajillo peppers" under guajillo, not under
  // the peppercorn "pepper" names). The whole of the words read is no parent
  // of itself, but its singular may be.
  for (let length = words.length; length >= 1; length -= 1) {
    // Where the window the words end with starts.
    const tail = words.length - length;
    const readable = (start: number) => !(length === 1 && rules.notFoods.has(words[start]!));

    if (length < words.length || cut > 0) {
      for (let start = tail; start >= 0; start -= 1) {
        if (readable(start)) {
          windows.push({
            fold: words.slice(start, start + length).join(" "),
            sure: start === tail,
          });
        }
      }
    }
    if (readable(tail)) {
      for (const reading of inflectedReadings(words.slice(tail).join(" "), rules)) {
        windows.push({ fold: reading, sure: true });
      }
    }
  }

  if (windows.length === 0) return null;

  const seeded = new Map(
    (await findSeededFoodSpellingsByFolds(windows.map((window) => window.fold))).map((row) => [
      row.fold,
      row.ingredientId,
    ])
  );

  for (const window of windows) {
    const id = seeded.get(window.fold);

    if (id) return { id, sure: window.sure };
  }

  return null;
}

/** The parent a text would be filed under from its words, for the startup pass over old mints. */
export async function parentFromWordsOf(text: string): Promise<ParentFromWords | null> {
  return await parentFromWords(spellingOf(cleanIngredientText(text), await currentRules()));
}

/**
 * The plain name a text would be minted under today, where it differs from
 * the text itself, for the startup pass over old mints: null where the text
 * is its own plain name already.
 */
export async function plainNameOf(text: string): Promise<{ text: string; fold: string } | null> {
  const spelling = spellingOf(cleanIngredientText(text), await currentRules());

  return spelling.plainFold && spelling.plainFold !== spelling.fold
    ? { text: spelling.plain, fold: spelling.plainFold }
    : null;
}

/** The one alias a spelling gives its food: its plain name, else its bare one, else its words ("(salt)" is "salt"). */
function cleanAlias({ clean, fold, bare, bareFold, plain, plainFold }: Spelling) {
  if (plainFold) return { text: plain, fold: plainFold };
  if (bareFold) return { text: bare, fold: bareFold };

  return {
    text: clean
      .replace(/[()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    fold,
  };
}

/** The Ingredient an alias points at. */
export async function ingredientFor(aliasId: string): Promise<IngredientRow | null> {
  return await findIngredientByAliasId(aliasId);
}

/**
 * The Ingredient a text already resolves to — an exact or a stripped alias
 * match — or null where Norish does not know it. For readers, which must not
 * mint: asking what a Store knows about a name Norish has never seen is
 * answered with nothing.
 */
export async function findIngredientFor(text: string): Promise<IngredientRef | null> {
  const cleaned = cleanIngredientText(text);

  if (!cleaned) return null;

  const spelling = spellingOf(cleaned, await currentRules());
  const match = matchKnown(spelling, await knownAliases([spelling]));

  return match ? { aliasId: match.aliasId, ingredientId: match.ingredientId } : null;
}

/**
 * The Ingredients other than `ingredientId` that these texts resolve to by
 * the first two rungs, leaving the Ingredient's own spellings out: whether an
 * old mint's spellings would now name a known food, for the startup pass
 * that looks at old Flagged Ingredients again. Mints nothing.
 */
export async function findOtherIngredientsFor(
  ingredientId: string,
  texts: readonly string[]
): Promise<Set<string>> {
  const rules = await currentRules();
  const spellings = texts
    .map(cleanIngredientText)
    .filter((text) => text.length > 0)
    .map((text) => spellingOf(text, rules));
  const known = new Map(
    [...(await knownAliases(spellings))].filter(([, row]) => row.ingredientId !== ingredientId)
  );
  const found = new Set<string>();

  for (const spelling of spellings) {
    const match = matchKnown(spelling, known);

    if (match) found.add(match.ingredientId);
  }

  return found;
}

/**
 * Resolve, then write what was resolved: the one way a write that stores a
 * reference to an Ingredient is made. Resolution and the write are separate
 * transactions, so a merge or a deletion can land between them; when the
 * write finds its Ingredient or alias gone, both run once more, and the text
 * then names the food the merge left (its alias moved with it) or a fresh
 * mint. `resolve` is the resolution itself — `resolveIngredient`,
 * `resolveGroceryNames`, `withResolvedIngredients` — so the second run can
 * never write the first run's stale ids.
 */
export async function writeResolved<R, T>(
  resolve: () => Promise<R>,
  write: (resolved: R) => Promise<T>
): Promise<T> {
  try {
    return await write(await resolve());
  } catch (error) {
    if (!isStaleIngredientReference(error)) throw error;
    dbLogger.warn(
      { err: error },
      "An Ingredient went away between resolving and writing; resolving again"
    );

    return await write(await resolve());
  }
}
