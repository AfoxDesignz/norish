/**
 * The cleanup the first start of this release runs over what earlier versions left (ADR-0037),
 * once per `CLEANUP_VERSION`, after the seed and the recheck, with AI off:
 *
 * 1. seeded spellings lose their stray marks ("3wu)", "|चौलाई}}"); balanced brackets stay;
 * 2. a spelling whose fold is already clean ("gyoza vellen )") gets its clean text;
 * 3. every other own spelling that is not its own clean name ("gyoza vellen ((ontdooid))") is
 *    removed, and the rows it named are resolved again from their own text. Where no spelling has
 *    its clean name yet, it takes the clean name in place, so its food keeps its rows;
 * 4. an own food whose name the joining words split into known foods ("zout en peper") is split
 *    into them and removed, even one a person kept distinct;
 * 5. the AI pass is asked about every own food no person decided about.
 */
import type { CleanupSpelling, NamingRow } from "@norish/db/repositories/ingredient-cleanup";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import { withTransaction } from "@norish/db/drizzle";
import {
  deleteCatalogueAlias,
  deleteCatalogueIngredient,
  listAskableIngredientIds,
} from "@norish/db/repositories/ingredient-catalogue";
import {
  findRowsNamingSpellings,
  foodSpelled,
  listOwnFoodsWithSpellings,
  listSpellingsForCleanup,
  repointGroceries,
  repointLines,
  rewriteSpelling,
  spellingsBeside,
} from "@norish/db/repositories/ingredient-cleanup";
import {
  lockIngredients,
  lockTree,
  mergeCatalogueIngredients,
  splitCatalogueIngredient,
} from "@norish/db/repositories/ingredient-relocation";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { createLogger } from "@norish/shared-server/logger";
import { ingredients as ingredientsRealtime } from "@norish/shared-server/realtime/ingredients";
import { lineFoodText, lineNamesNoFood } from "@norish/shared/lib/ingredient-text";
import { ingredientAliasFold, withoutStrayMarks } from "@norish/shared/lib/spelling-keys";

import type { ResolvedIngredient } from "../resolver";
import { cleanSpellingOf, partsByWordsOf, resolveIngredients, resolveLineFoods } from "../resolver";
import { readIngredientSeedState, updateIngredientSeedState } from "./catalogue-seed";

const log = createLogger("ingredient-cleanup");

/** Raised when a release needs the cleanup to run again. */
export const CLEANUP_VERSION = 1;

/**
 * How many spellings one round of step 3 removes before resolving their rows again. Each round
 * commits, so a boot cut short resumes where it stopped.
 * ponytail: ~9 statements per spelling, ~2 ms each with its row; a set-based removal if ticket 12
 * measures the 71k on the production copy as too slow a first boot.
 */
const REMOVED_PER_ROUND = 200;

export interface CleanupOutcome {
  /** Seeded spellings whose stray marks went (1). */
  seeded: number;
  /** Own spellings given their clean text in place (2, and 3 where the clean name was free). */
  cleaned: number;
  /** Own spellings removed, their rows resolved again (3). */
  removed: number;
  /** Joined foods split and removed (4). */
  split: number;
  /** Foods the AI pass was asked about (5). */
  asked: number;
}

/** An own spelling that is not its own clean name. */
interface Variant extends CleanupSpelling {
  clean: { text: string; fold: string };
}

/** Run the cleanup where this release's version of it has not run yet; null where it has. */
export async function cleanUpCatalogueOnFirstStart(
  askAI: (ingredientIds: string[]) => Promise<void>
): Promise<CleanupOutcome | null> {
  if ((await readIngredientSeedState()).cleanupVersion === CLEANUP_VERSION) return null;

  const outcome = await cleanUpCatalogue(askAI);

  // Recorded only once the whole pass is through, so a failure is retried in full at the next boot.
  await updateIngredientSeedState({ cleanupVersion: CLEANUP_VERSION });
  log.info({ ...outcome, cleanupVersion: CLEANUP_VERSION }, "Catalogue cleaned up");

  // Removed spellings, splits and merges change which food rows mean: open clients refetch.
  if (outcome.seeded + outcome.cleaned + outcome.removed + outcome.split > 0) {
    await ingredientsRealtime.publish("changed", { ingredientIds: [] }, undefined);
  }

  return outcome;
}

async function cleanUpCatalogue(
  askAI: (ingredientIds: string[]) => Promise<void>
): Promise<CleanupOutcome> {
  const outcome: CleanupOutcome = { seeded: 0, cleaned: 0, removed: 0, split: 0, asked: 0 };
  const spellings = await listSpellingsForCleanup();
  const variants: Variant[] = [];

  for (const spelling of spellings) {
    if (spelling.seeded) {
      const text = withoutStrayMarks(spelling.text);

      if (text && text !== spelling.text) {
        if (await rewriteSpelling(spelling.id, { text, fold: ingredientAliasFold(text) })) {
          outcome.seeded += 1;
        }
      }
      continue;
    }

    const clean = await cleanSpellingOf(spelling.text);

    if (clean.text !== spelling.text || clean.fold !== spelling.fold) {
      variants.push({ ...spelling, clean });
    }
  }

  // Step 2 before 3, so a dirty spelling holds its clean name before a variant asks for it.
  const removing: Variant[] = [];

  for (const variant of [...variants].sort(
    (a, b) => Number(b.fold === b.clean.fold) - Number(a.fold === a.clean.fold)
  )) {
    if (variant.clean.fold && (await rewriteSpelling(variant.id, variant.clean))) {
      outcome.cleaned += 1;
    } else {
      removing.push(variant);
    }
  }
  for (let start = 0; start < removing.length; start += REMOVED_PER_ROUND) {
    outcome.removed += await removeVariants(removing.slice(start, start + REMOVED_PER_ROUND));
  }

  for (const food of await listOwnFoodsWithSpellings()) {
    const split = await partsByWordsOf(food.id, [food.name, ...food.aliases]);

    if (split && (await splitFood(food.id, split.parts, split.joined))) outcome.split += 1;
  }

  const askable = await listAskableIngredientIds();

  await askAI(askable);
  outcome.asked = askable.length;

  return outcome;
}

/**
 * Remove these spellings, then resolve the rows they named again from their own text, with AI
 * off. A food left with no spelling joins the food its clean name names, or goes where that
 * names none (")"), as its rows would. Answers how many went.
 */
async function removeVariants(variants: readonly Variant[]): Promise<number> {
  let removed = 0;
  const named = await withTransaction(async (tx) => {
    await lockTree(tx);
    const rows = await findRowsNamingSpellings(
      tx,
      variants.map((variant) => variant.id)
    );

    for (const variant of variants) {
      const beside = await spellingsBeside(tx, variant.id);

      if (!beside) continue;
      if (beside.others === 0) {
        const target = variant.clean.fold ? await foodSpelled(tx, variant.clean.fold) : null;

        if (!target) {
          await deleteCatalogueIngredient(tx, beside.ingredientId);
          removed += 1;
          continue;
        }
        await mergeCatalogueIngredients(tx, beside.ingredientId, target);
      }
      await deleteCatalogueAlias(tx, variant.id);
      removed += 1;
    }

    return rows;
  });

  await resolveAgain(named);

  return removed;
}

/** Point each row at what its own text resolves to, with AI off, minting for its owner. */
async function resolveAgain(rows: Awaited<ReturnType<typeof findRowsNamingSpellings>>) {
  const units = await getUnits();
  const lines = await resolveByOwner(rows.lines, async (owned, userId) => {
    const texts = owned.map(({ name, amount, unit }) =>
      lineNamesNoFood({ text: name ?? "", amount })
        ? ""
        : lineFoodText({ text: name ?? "", amount, unit }, units)
    );
    const foods = await resolveLineFoods(texts, { userId }, { ai: false });

    return owned.map((line, index) => ({
      id: line.id,
      aliasIds: foods[index]?.foods.map((food) => food.aliasId) ?? [],
      joined: foods[index]?.joined ?? null,
    }));
  });
  const groceriesOf = (named: NamingRow[]) =>
    resolveByOwner(named, async (owned, userId) => {
      const foods = await resolveIngredients(
        owned.map((row) => row.name ?? ""),
        { userId },
        { ai: false }
      );

      return owned.map((row, index) => ({
        id: row.id,
        aliasId: foods[index]?.aliasId ?? null,
        ingredientId: foods[index]?.ingredientId ?? null,
      }));
    });
  const [groceries, recurring] = [
    await groceriesOf(rows.groceries),
    await groceriesOf(rows.recurring),
  ];

  await withTransaction(async (tx) => {
    await repointLines(tx, lines);
    await repointGroceries(tx, "groceries", groceries);
    await repointGroceries(tx, "recurring", recurring);
  });
}

/** Resolve rows a batch per owner, so what a text mints is its row's owner's. */
async function resolveByOwner<R extends NamingRow, T>(
  rows: readonly R[],
  resolve: (owned: R[], userId: string | null) => Promise<T[]>
): Promise<T[]> {
  const byOwner = new Map<string | null, R[]>();
  const resolved: T[] = [];

  for (const row of rows) byOwner.set(row.ownerId, [...(byOwner.get(row.ownerId) ?? []), row]);

  for (const [userId, owned] of byOwner) resolved.push(...(await resolve(owned, userId)));

  return resolved;
}

/** Split a joined food into the foods its name joins, and remove it; false where one went meanwhile. */
async function splitFood(
  ingredientId: string,
  parts: readonly ResolvedIngredient[],
  joined: LineJoin
): Promise<boolean> {
  const [first, ...rest] = parts;

  if (!first) return false;
  const ids = [ingredientId, ...parts.map((part) => part.ingredientId)];

  return await withTransaction(async (tx) => {
    await lockTree(tx);
    if ((await lockIngredients(tx, ids)) < new Set(ids).size) return false;
    await splitCatalogueIngredient(tx, ingredientId, [first, ...rest], joined);

    return true;
  });
}
