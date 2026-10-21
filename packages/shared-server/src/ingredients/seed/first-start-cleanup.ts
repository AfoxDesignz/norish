/**
 * The first start's cleanup of what earlier versions left (ADR-0037; ingredient-cleanup ticket 09),
 * once per `CLEANUP_VERSION`: each step's function says what it does.
 */
import type { CleanupSpelling } from "@norish/db/repositories/ingredient-cleanup";
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
  listOwnFoods,
  listSpellingsForCleanup,
  renameFood,
  rewriteSpelling,
  spellingsBeside,
} from "@norish/db/repositories/ingredient-cleanup";
import {
  lockIngredients,
  lockTree,
  mergeCatalogueIngredients,
  splitCatalogueIngredient,
} from "@norish/db/repositories/ingredient-relocation";
import { lineNamesNoFood } from "@norish/shared/lib/ingredient-text";
import { ingredientAliasFold, withoutStrayMarks } from "@norish/shared/lib/spelling-keys";

import type { ResolvedIngredient } from "../resolver";
import { resolveAgain } from "../catalogue";
import { cleanSpellingOf, partsByWordsOf } from "../resolver";
import { oncePerVersion } from "./catalogue-seed";

/** Raised when a release needs the cleanup to run again. */
export const CLEANUP_VERSION = 2;

/** How many variants one round removes; each round commits, so a boot cut short resumes. */
// ponytail: ~2 ms a variant, ~2.5 min for production's 71k; set-based if ticket 12 finds it slow.
const REMOVED_PER_ROUND = 200;

export interface CleanupOutcome {
  /** Seeded spellings whose stray marks went (1). */
  seeded: number;
  /** Own spellings given their clean text in place (2, and 3 where the clean name was free). */
  cleaned: number;
  /** Own spellings removed, their rows resolved again (3, and 2's that name no food). */
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
  return await oncePerVersion("cleanupVersion", CLEANUP_VERSION, {
    pass: () => cleanUpCatalogue(askAI),
    // Removed spellings, splits and merges change which food rows mean.
    changed: (outcome) =>
      outcome.seeded + outcome.cleaned + outcome.removed + outcome.split + outcome.renamed > 0,
    done: "Catalogue cleaned up",
  });
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
  // One a line would name no food by ("Voor de salade:") always goes, so its lines name none.
  const removing: Variant[] = [];

  for (const variant of [...variants].sort(
    (a, b) => Number(b.fold === b.clean.fold) - Number(a.fold === a.clean.fold)
  )) {
    if (
      variant.clean.fold &&
      !lineNamesNoFood({ text: variant.text }) &&
      (await rewriteSpelling(variant.id, variant.clean))
    ) {
      outcome.cleaned += 1;
    } else {
      removing.push(variant);
    }
  }
  for (let start = 0; start < removing.length; start += REMOVED_PER_ROUND) {
    outcome.removed += await removeVariants(removing.slice(start, start + REMOVED_PER_ROUND));
  }

  // 4. An own food whose name is joined ("zout en peper") is split, even one kept distinct; a mix
  // holding a joined spelling stays. Any other takes the clean name its name reduces to.
  for (const food of await listOwnFoods()) {
    const split = await partsByWordsOf(food.id, food.name);

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

        // A colon spelling's fold may be its clean one, so the food holding it is its own.
        if (!target || target === beside.ingredientId) {
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

  await resolveAgain(named, { mint: true });

  return removed;
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
