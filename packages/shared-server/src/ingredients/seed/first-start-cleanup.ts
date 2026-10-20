/**
 * The first start's cleanup of what earlier versions left (ADR-0037; ingredient-cleanup ticket 09),
 * once per `CLEANUP_VERSION`: each step's function says what it does.
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
  renameFood,
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

/** How many variants one round removes; each round commits, so a boot cut short resumes. */
// ponytail: ~2 ms a variant, ~2.5 min for production's 71k; set-based if ticket 12 finds it slow.
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
  /** Own foods given the clean name their name reduces to (4). */
  renamed: number;
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
  if (outcome.seeded + outcome.cleaned + outcome.removed + outcome.split + outcome.renamed > 0) {
    await ingredientsRealtime.publish("changed", { ingredientIds: [] }, undefined);
  }

  return outcome;
}

async function cleanUpCatalogue(
  askAI: (ingredientIds: string[]) => Promise<void>
): Promise<CleanupOutcome> {
  // 1. Seeded spellings lose their stray marks ("3wu)"); balanced brackets stay ("paprika (vrucht)").
  const outcome: CleanupOutcome = {
    seeded: 0,
    cleaned: 0,
    removed: 0,
    split: 0,
    renamed: 0,
    asked: 0,
  };
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

  // 2 and 3. An own spelling that is not its own clean name takes it where it is free, the dirty
  // ones first ("gyoza vellen )"); the rest go, and their rows are resolved again (`removeVariants`).
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

  // 4. A joined own food ("zout en peper") is split into its foods, even one kept distinct; any
  // other takes the clean name its name reduces to, unless a person named it.
  for (const food of await listOwnFoodsWithSpellings()) {
    const split = await partsByWordsOf(food.id, [food.name, ...food.aliases]);

    if (split) {
      if (await splitFood(food.id, split.parts, split.joined)) outcome.split += 1;
      continue;
    }
    const clean = await cleanSpellingOf(food.name);

    if (clean.fold && clean.text !== food.name && (await renameFood(food.id, clean.text))) {
      outcome.renamed += 1;
    }
  }

  // 5. The AI pass, over every own food no person decided about.
  const askable = await listAskableIngredientIds();

  await askAI(askable);
  outcome.asked = askable.length;

  return outcome;
}

/**
 * Remove these spellings and resolve their rows again, AI off; a food left with none joins the food
 * holding its clean name, or goes where that names nothing (")"). Answers how many went.
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
