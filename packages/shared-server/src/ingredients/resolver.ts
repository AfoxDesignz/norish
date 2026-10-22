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
  findAliasesNearFold,
  findIngredientAliasesByFolds,
  findIngredientByAliasId,
  findIngredientsNamed,
  findSeededFoodSpellingsByFolds,
  mintIngredientWithAliases,
} from "@norish/db/repositories/ingredient-aliases";
import { findIngredientIdsAmong } from "@norish/db/repositories/ingredient-catalogue";
import { listJunkFolds } from "@norish/db/repositories/ingredient-junk-pile";
import {
  getIngredientWords,
  getUnits,
  isAIEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { dbLogger } from "@norish/shared-server/logger";
import { stripHtmlTags } from "@norish/shared/lib/helpers";
import { catalogueLanguagesFor, norishReads } from "@norish/shared/lib/ingredient-names";
import { namesNoFood } from "@norish/shared/lib/ingredient-text";
import { distinctFoods, joinOf } from "@norish/shared/lib/line-foods";
import { mayBeASlip, onlyNearest, slipsNear } from "@norish/shared/lib/name-slips";
import {
  inflectedReadings,
  ingredientAliasFold,
  joinedParts,
  spellingKeys,
  spellingRules,
} from "@norish/shared/lib/spelling-keys";

import { announceMinted, announcingAfter } from "./minted";

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
 *   3. a known food the text is a slip of the fingers from ("barmezaan" for
 *      "parmezaan"), which takes the text's clean spelling (`findSlips`);
 *   4. a new Ingredient, flagged. No AI is asked here: AI's pass follows the
 *      mint in the background (`announceMinted`).
 *
 * A mint or a join gives the food only the text's clean spelling, its plain
 * name else its bare one, never the text as written (ADR-0037).
 *
 * A mint's words may file it under a seeded spelling they end with ("ground cumin") or start with
 * before forms alone ("mango blokjes"), never merge it (ADR-0039); else AI's pass files it.
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
 * 8: a parent found inside a name needs a spelling of four letters or more.
 * 9: a name is read up to a note, and a parent it starts with before its
 * cuts and forms alone is sure. 10: a spelling anywhere else in a name gives
 * no parent, so 8's four letters go with it.
 */
export const RUNG_VERSION = 10;

/** Who the resolution is for: the owner of anything it mints. */
export interface ResolveActor {
  userId: string | null;
  /** The language the text is in, where the caller knows it. */
  locale?: string | null;
}

export interface ResolveOptions {
  /** Whether AI's pass follows a mint; off, a mint is flagged as the upgrade's (the startup passes). */
  ai?: boolean;
  /** Off, a text names only what rungs 1 and 2 or its joining words find: no slip, no mint. */
  mint?: boolean;
  /** Off, a text rungs 1 and 2 miss is minted, never taken as a slip (a split part AI found nothing for). */
  slips?: boolean;
}

/** One text as written, and the alias and Ingredient it resolved to. */
export interface ResolvedIngredient extends IngredientRef {
  text: string;
}

/**
 * A text as the first two rungs read it: as written, its keys (clean, its
 * fold, its folds with the preparation stripped), the one key texts the rungs
 * read alike share (`foodKey`), its other readings as the same food (plurals
 * and diminutives), and the rules it was read by.
 */
interface Spelling extends SpellingKeys {
  text: string;
  key: string;
  inflected: string[];
  rules: ResolverRules;
}

/** The spelling rules and the junk pile's folds (CONTEXT.md), which a name is read without. */
interface ResolverRules extends SpellingRules {
  junk: ReadonlySet<string>;
}

/** The pieces a cut makes (a comma, a joining word), without those whose fold or plain fold is junk. */
function withoutJunk(pieces: readonly string[], rules: ResolverRules): string[] {
  return pieces.filter((piece) => {
    if (rules.junk.has(ingredientAliasFold(piece))) return false;

    return !rules.junk.has(spellingKeys(piece, rules).plainFold);
  });
}

/** A text's pieces at its commas outside brackets, as written. */
function commaPieces(text: string): string[] {
  const pieces = [""];
  let depth = 0;

  for (const char of text) {
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) pieces.push("");
    else pieces[pieces.length - 1] += char;
  }

  return pieces;
}

/**
 * A text without its comma pieces and joining-word parts on the junk pile; a part left keeps the
 * joining word before it.
 */
function withoutJunkPieces(text: string, rules: ResolverRules): string {
  const pieces = commaPieces(text);
  const kept = withoutJunk(pieces, rules);
  const rest = kept.length === pieces.length ? text : kept.join(",");
  const joined = joinedParts(rest, rules);

  if (!joined) return rest;
  const parts = new Set(withoutJunk(joined.parts, rules));
  const left = joined.parts.flatMap((part, index) => (parts.has(part) ? [index] : []));

  if (left.length === joined.parts.length) return rest;

  return left
    .flatMap((index, at) => [
      ...(at > 0 ? [joined.words[index - 1]!.text] : []),
      joined.parts[index]!,
    ])
    .join(" ");
}

/**
 * A text read on its pieces not on the junk pile: "boneless, skinless chicken" is "skinless chicken".
 * `whole` reads it with no size or preparation word stripped ("petite potatoes" is not "potatoes").
 */
function spellingOf(text: string, rules: ResolverRules, whole = false): Spelling {
  const found = spellingKeys(withoutJunkPieces(text, rules), rules);
  const keys = whole
    ? { ...found, plain: found.bare, plainFold: found.bareFold || found.fold }
    : found;
  const key = keys.plainFold || keys.fold;

  return { text, ...keys, key, inflected: inflectedReadings(key, rules, true), rules };
}

/** How long built rules are reused: a pass over an instance's history asks thousands of times a minute. */
export const RULES_TTL_MS = 10_000;

let builtRules: { at: number; rules: Promise<ResolverRules> } | null = null;

/**
 * The rules rung 2 reads a name by: the administrator's units map and
 * ingredient words, built at most once every few seconds, so an edit lands
 * almost at once and an upgrade's thousands of names don't rebuild them each.
 */
/** Read the units map, the ingredient words and the junk pile afresh next time: one just changed. */
export function forgetSpellingRules(): void {
  builtRules = null;
}

async function currentRules(): Promise<ResolverRules> {
  const now = Date.now();

  if (!builtRules || now - builtRules.at > RULES_TTL_MS) {
    const rules = Promise.all([getUnits(), getIngredientWords(), listJunkFolds()]).then(
      ([units, words, junk]) => ({ ...spellingRules(units, words), junk: new Set(junk) })
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
  const resolved = await resolveTexts(texts, actor, options, false);

  return resolved.map((one) => (one?.foods[0] ? { text: one.text, ...one.foods[0] } : null));
}

/** A split's foods in order: a found part as is, a text resolved without a split of its own. */
export async function resolveParts(
  parts: ReadonlyArray<string | ResolvedIngredient>,
  actor: ResolveActor,
  options: ResolveOptions = {}
): Promise<ResolvedIngredient[]> {
  const resolved = await resolveIngredients(
    parts.filter((part) => typeof part === "string"),
    actor,
    options
  );

  return parts
    .map((part) => (typeof part === "string" ? resolved.shift() : part))
    .filter((part) => part != null);
}

/** One text as written, and the foods it names in order, with how several go together. */
export interface ResolvedFoods extends LineResolution {
  text: string;
}

/** Resolve recipe lines' texts as `resolveIngredients` does, except that a text its words split names each food. */
export async function resolveLineFoods(
  texts: readonly string[],
  actor: ResolveActor,
  options: ResolveOptions = {}
): Promise<Array<ResolvedFoods | null>> {
  return await resolveTexts(texts, actor, options, true);
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

/** A text split at its joining words (`joinedParts`), each part's readings as spellings, in order. */
interface SpelledParts extends JoinedParts {
  readings: Spelling[][];
}

function spelledParts(clean: string, rules: ResolverRules): SpelledParts | null {
  const found = joinedParts(clean, rules);

  return (
    found && {
      ...found,
      readings: sharedWordReadings(found.parts, found.joined).map((texts) =>
        texts.map((text) => spellingOf(text, rules))
      ),
    }
  );
}

/**
 * Each part's readings: an alternative shorter than the last (the first) first takes its extra last
 * (first) words ("cherry or grape tomatoes": "cherry tomatoes"); a part ending in "-" only that way.
 */
function sharedWordReadings(parts: readonly string[], joined: LineJoin): string[][] {
  const words = parts.map((part) => part.split(" "));

  return words.map((own, index) => {
    const last = index === words.length - 1;
    const other = last ? words[0]! : words.at(-1)!;
    const hyphen = !last && own.at(-1)!.endsWith("-");
    // Foods joined together borrow only after a hyphen: "garlic and olive oil" is no garlic oil.
    const shorter = joined === "alternatives" || hyphen ? other.length - own.length : 0;
    const extra = Math.max(shorter, hyphen ? 1 : 0);
    const asWritten = parts[index]!;

    if (!extra) return [asWritten];
    const borrowed = last
      ? [...other.slice(0, extra), asWritten].join(" ")
      : [hyphen ? asWritten.slice(0, -1) : asWritten, ...other.slice(-extra)].join(" ");

    return hyphen ? [borrowed] : [borrowed, asWritten];
  });
}

/**
 * The foods a text's joining words split it into, each with the part naming it, where the first two
 * rungs know every part; parts that are one food name it alone. Undefined where they name no foods.
 */
function foodsByWords(
  parts: SpelledParts,
  known: ReadonlyMap<string, IngredientAliasRow>
): { foods: ResolvedIngredient[]; joined: LineJoin | null } | undefined {
  const matched = parts.readings.map((readings) =>
    readings
      .flatMap((reading) => {
        const alias = matchKnown(reading, known);

        return alias ? [{ reading, alias }] : [];
      })
      .at(0)
  );

  if (!matched.every((match) => match !== undefined)) return undefined;
  const aliases = matched.map((match) => match.alias);

  // A word that joins a measure somewhere ("of") splits no name whose every part is spelled there.
  const spelledIn = (languages: ReadonlySet<string>) => (alias: IngredientAliasRow) =>
    alias.locale !== null && catalogueLanguagesFor(alias.locale).every((l) => languages.has(l));

  if (parts.words.some((word) => aliases.every(spelledIn(word.connectorIn)))) return undefined;

  const foods = distinctFoods(
    aliases.map(({ aliasId, ingredientId }, index) => ({
      aliasId,
      ingredientId,
      text: matched[index]!.reading.text,
    }))
  );

  return { foods, joined: joinOf(foods, parts.joined) };
}

/**
 * The aliases spellings and, with `splitJoined`, their joined parts match, and the foods the words
 * name for each spelling not known whole. One query; mints nothing.
 */
async function readByWords(
  asWritten: readonly Spelling[],
  rules: ResolverRules,
  splitJoined: boolean
) {
  const spellings = asWritten.filter((spelling) => !spellingNamesNoFood(spelling));
  const splits = new Map(
    (splitJoined ? spellings : []).flatMap((spelling) => {
      const spelled = spelledParts(spelling.clean, rules);

      return spelled ? [[spelling, spelled] as const] : [];
    })
  );
  const known = await knownAliases([
    ...spellings,
    ...[...splits.values()].flatMap((found) => found.readings.flat()),
  ]);
  const byWords = new Map(
    [...splits].flatMap(([spelling, found]) => {
      const foods = matchKnown(spelling, known) ? undefined : foodsByWords(found, known);

      return foods ? [[spelling, foods] as const] : [];
    })
  );

  return { spellings, known, byWords };
}

/** `splitJoined` reads a text not known whole by its joining words before anything is minted. */
async function resolveTexts(
  texts: readonly string[],
  actor: ResolveActor,
  options: ResolveOptions,
  splitJoined: boolean
): Promise<Array<ResolvedFoods | null>> {
  const rules = await currentRules();
  const asWritten = texts.map((text) => spellingOf(cleanIngredientText(text), rules));
  const { spellings, known, byWords } = await readByWords(asWritten, rules, splitJoined);
  const unknown = spellings.filter(
    (spelling) => !matchKnown(spelling, known) && !byWords.has(spelling)
  );
  const slips = await findSlips(options.mint === false || options.slips === false ? [] : unknown);
  let flagReason: Promise<FlagReason> | undefined;
  const resolved = new Map<Spelling, ResolvedFoods>();
  const minted = new Set<string>();

  for (const spelling of spellings) {
    const named = byWords.get(spelling);

    if (named) {
      resolved.set(spelling, {
        text: spelling.text,
        foods: named.foods.map(refOf),
        joined: named.joined,
      });
      continue;
    }

    const match = matchKnown(spelling, known);

    if (!match && options.mint === false) continue;
    if (!match) {
      const slip = onlyNearest(slips.get(spelling.key) ?? []);
      // The food a slip names may have been merged away since it was found; the text is then minted.
      const joined = slip
        ? await addIngredientAliases({
            ingredientId: slip.ingredientId,
            aliases: [cleanAlias(spelling)],
            ownerId: actor.userId,
            locale: actor.locale ?? null,
          })
        : null;
      const rows =
        joined ??
        (await mint(spelling, actor, {
          flagReason: slip ? "food-gone" : await (flagReason ??= mintFlag(options)),
          parent: await parentFromWords(spelling),
        }));

      for (const row of rows) known.set(row.fold, row);
      if (!joined) for (const row of rows) minted.add(row.ingredientId);
    }

    const alias = match ?? matchKnown(spelling, known)!;

    resolved.set(spelling, {
      text: spelling.text,
      foods: [refOf(alias)],
      joined: null,
    });
  }

  // AI's pass follows a mint for someone's action, never one made with AI off.
  if (options.ai !== false) await announceMinted([...minted]);

  return asWritten.map((spelling) => resolved.get(spelling) ?? null);
}

/** Why a mint is flagged: AI's pass is about to look at it, unless AI or the pass is off. */
async function mintFlag(options: ResolveOptions): Promise<FlagReason> {
  if (options.ai === false) return "upgrade";

  return (await isAIEnabled()) ? "ai-queued" : "ai-off";
}

/**
 * The known foods each spelling is a slip of the fingers from ("parmezan" for "parmezaan"), by its
 * key, best first (`slipsNear`).
 */
async function findSlips(
  spellings: readonly Spelling[],
  keep: (row: IngredientAliasRow) => boolean = () => true
): Promise<Map<string, FoundFood[]>> {
  const slips = new Map<string, FoundFood[]>();
  const keys = new Set(spellings.map((spelling) => spelling.key));

  await Promise.all(
    [...keys].map(async (key) => {
      if (!mayBeASlip(key)) return;
      const near = slipsNear(
        key,
        (await findAliasesNearFold(key)).filter(keep),
        (row) => row.fold,
        (row) => row.ingredientId
      );

      if (near.length > 0) {
        slips.set(
          key,
          near.map(({ item, score }) => ({ ...refOf(item), score, matched: item.text }))
        );
      }
    })
  );

  return slips;
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

/** Rung 4: a flagged Ingredient named for the text's clean spelling, under the food its words suggest. */
async function mint(
  spelling: Spelling,
  actor: ResolveActor,
  { flagReason, parent }: { flagReason: FlagReason; parent: string | null }
): Promise<IngredientAliasRow[]> {
  const alias = cleanAlias(spelling);

  return await mintIngredientWithAliases({
    name: alias.text,
    aliases: [alias],
    ownerId: actor.userId,
    locale: actor.locale ?? null,
    flagged: true,
    flagReason,
    parentId: parent,
  });
}

/**
 * The longest seeded spelling a mint's words end with (or its singular), or start with before forms
 * and sizes alone, read up to a word a name ends before ("in", "om"); else null.
 */
async function parentFromWords(spelling: Spelling): Promise<string | null> {
  const { rules } = spelling;
  const all = spelling.key.split(" ");
  const cut = all.findIndex((word, index) => index > 0 && rules.endsBefore.has(word));
  const words = cut > 0 ? all.slice(0, cut) : all;
  const windows: string[] = [];

  // Longest first; within a length the words it ends with, then those it starts with before
  // cuts and sizes alone, then its end in the singular (the whole words only in the singular).
  for (let length = words.length; length >= 1; length -= 1) {
    // Where the window the words end with starts.
    const tail = words.length - length;
    const readable = (start: number) => !(length === 1 && rules.notFoods.has(words[start]!));
    const formed =
      tail > 0 &&
      readable(0) &&
      words.slice(length).every((word) => rules.forms.has(word) || rules.sizes.has(word));

    if ((length < words.length || cut > 0) && readable(tail)) {
      windows.push(words.slice(tail).join(" "));
    }
    if (formed) windows.push(words.slice(0, length).join(" "));
    if (readable(tail)) windows.push(...inflectedReadings(words.slice(tail).join(" "), rules));
  }

  if (windows.length === 0) return null;

  const seeded = new Map(
    (await findSeededFoodSpellingsByFolds(windows))
      .filter((row) => norishReads(row.locale))
      .map((row) => [row.fold, row.ingredientId])
  );

  for (const window of windows) {
    const id = seeded.get(window);

    if (id) return id;
  }

  return null;
}

/** The parent a text would be filed under from its words, for the startup pass over old mints. */
export async function parentFromWordsOf(text: string): Promise<string | null> {
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

/** The rules without the junk pile: the first-start cleanup leaves junk to AI's spelling check. */
async function cleanupRules(): Promise<ResolverRules> {
  return { ...(await currentRules()), junk: new Set() };
}

/** The clean spelling a text reduces to, as a mint or a join adds it, for the first-start cleanup. */
export async function cleanSpellingOf(text: string): Promise<{ text: string; fold: string }> {
  return cleanAlias(spellingOf(cleanIngredientText(text), await cleanupRules()));
}

/**
 * Where a food's name is joined ("zout en peper") and every part is another known food, those
 * foods and the join, for the first-start cleanup; else null.
 */
export async function partsByWordsOf(
  ingredientId: string,
  name: string
): Promise<{ parts: ResolvedIngredient[]; joined: LineJoin } | null> {
  const rules = await cleanupRules();
  const spelled = spelledParts(spellingOf(cleanIngredientText(name), rules).clean, rules);

  if (!spelled) return null;
  const known = new Map(
    [...(await knownAliases(spelled.readings.flat()))].filter(
      ([, row]) => row.ingredientId !== ingredientId
    )
  );
  const named = foodsByWords(spelled, known);

  return named?.joined ? { parts: named.foods, joined: named.joined } : null;
}

/** The one alias a spelling gives its food: its plain name, else its words ("(salt)" is "salt"). */
function cleanAlias({ clean, fold, plain, plainFold }: Spelling) {
  if (plainFold) return { text: plain, fold: plainFold };

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

  return match ? refOf(match) : null;
}

/**
 * A food a name finds, scored `EXACT` by its own spelling, less by a slip (`slipsNear`), and the
 * spelling of it that matched.
 */
export type FoundFood = IngredientRef & { score: number; matched: string };

const EXACT = 1;

/** Whether a name found the food by its own spelling, not a slip of the fingers. */
export function isExact(found: FoundFood): boolean {
  return found.score === EXACT;
}

/** Just the alias and food of a row that carries more. */
export function refOf({ aliasId, ingredientId }: IngredientRef): IngredientRef {
  return { aliasId, ingredientId };
}

/**
 * Each readable spelling's food other than `ingredientId`: the food named it, else the one food
 * rungs 1–2 find in a language Norish reads; and that filter, for slips.
 */
async function otherFoodsSpelled(ingredientId: string, spellings: readonly Spelling[]) {
  const readable = spellings.filter((spelling) => spelling.text && !spellingNamesNoFood(spelling));
  const all = await knownAliases(readable);
  // Only by a spelling in a language Norish reads: AI's "bun" is not pear's Volapük "bün".
  const other = (row: IngredientAliasRow) =>
    row.ingredientId !== ingredientId && norishReads(row.locale);
  const known = new Map([...all].filter(([, row]) => other(row)));
  // A food's name beats another food's spelling (yam's Croatian "jam" is not the food jam); a
  // spelling the asked food holds stays its own, so a split moves it to the food named for it.
  const named = new Map(
    (
      await findIngredientsNamed(
        readable.flatMap((spelling) => [spelling.fold, spelling.clean.toLowerCase()])
      )
    )
      .filter((row) => row.ingredientId !== ingredientId)
      .map((row) => [ingredientAliasFold(row.name), { ...refOf(row), text: row.name }])
  );
  const byName = (spelling: Spelling) =>
    all.get(spelling.fold)?.ingredientId === ingredientId ? undefined : named.get(spelling.fold);
  const matched = new Map(
    readable.map((spelling) => [spelling, byName(spelling) ?? matchKnown(spelling, known)])
  );

  return { matched, other };
}

/** The foods other than `ingredientId` rungs 1–2 find for a mint's spellings, for the recheck. */
export async function findOtherFoodsSpelled(
  ingredientId: string,
  texts: readonly string[]
): Promise<Set<string>> {
  const rules = await currentRules();
  const spellings = texts.map((text) => spellingOf(cleanIngredientText(text), rules));
  const { matched } = await otherFoodsSpelled(ingredientId, spellings);

  return new Set([...matched.values()].flatMap((match) => (match ? [match.ingredientId] : [])));
}

/**
 * The listed (or seeded) foods other than `except` each of AI's names finds, as written: the food
 * named it, else the one rungs 1–2 find, else every food a slip of the fingers away, best first.
 */
export async function findFood(
  names: readonly string[],
  { except, among }: { except: string; among: "listed" | "seeded" }
): Promise<FoundFood[][]> {
  const rules = await currentRules();
  const spellings = names.map((name) => spellingOf(cleanIngredientText(name), rules, true));
  const { matched, other } = await otherFoodsSpelled(except, spellings);
  const slipped = await findSlips(
    [...matched].flatMap(([spelling, match]) => (match ? [] : [spelling])),
    other
  );
  const found = spellings.map((spelling): FoundFood[] => {
    const match = matched.get(spelling);

    if (match) return [{ ...refOf(match), score: EXACT, matched: match.text }];

    return (matched.has(spelling) && slipped.get(spelling.key)) || [];
  });
  // A hidden food is never AI's answer: no merge into it, no parent, no split part. A category is
  // a seeded food: an own one may be a placeholder ("toppings") whose lines leave the choice open.
  const kept = await findIngredientIdsAmong(
    found.flat().map((one) => one.ingredientId),
    among
  );

  return found.map((foods) => foods.filter((one) => kept.has(one.ingredientId)));
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
export function writeResolved<R, T>(
  resolve: () => Promise<R>,
  write: (resolved: R) => Promise<T>
): Promise<T> {
  return announcingAfter(async () => {
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
  });
}
