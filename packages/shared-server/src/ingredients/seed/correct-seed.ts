/**
 * The seed's corrections (`SPELLING_MOVES`) made once on an instance seeded before them: the spelling
 * moves with its rows, and the own foods its words filed under the old food follow it.
 */
import {
  listSeededIngredientIds,
  listUnchosenOwnChildren,
  moveSeededSpelling,
  refileOwnFood,
} from "@norish/db/repositories/ingredient-seed";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import { readName } from "../resolver";
import {
  oncePerVersion,
  readIngredientSeedState,
  SEED_CORRECTIONS_VERSION,
  SPELLING_MOVES,
  updateIngredientSeedState,
} from "./catalogue-seed";

/** The corrections version from which a seed files a shared spelling under a language Norish reads. */
const NORISH_LANGUAGES_FIRST_IN = 3;

export interface CorrectionOutcome {
  /** Seeded spellings moved to the food the seed now gives them. */
  moved: number;
  /** Own foods the words filed under the old food, now under the new one. */
  refiled: number;
}

/** Make the corrections where this version of them has not been made; null where it has. */
export async function correctSeedOnce(): Promise<CorrectionOutcome | null> {
  return await oncePerVersion("correctionsVersion", SEED_CORRECTIONS_VERSION, {
    pass: correctSeed,
    changed: (outcome) => outcome.moved + outcome.refiled > 0,
    done: "Seed corrections made",
  });
}

async function correctSeed(from: number): Promise<CorrectionOutcome> {
  const seeded = await listSeededIngredientIds();
  const outcome: CorrectionOutcome = { moved: 0, refiled: 0 };

  for (const move of SPELLING_MOVES) {
    const fromId = seeded.get(move.from);
    const toId = seeded.get(move.to);

    if (!fromId || !toId) continue;
    for (const spelling of move.spellings) {
      if (await moveSeededSpelling(ingredientAliasFold(spelling), fromId, toId)) outcome.moved += 1;
    }
    for (const child of await listUnchosenOwnChildren(fromId)) {
      if (
        (await (await readName(child.name)).parent()) === toId &&
        (await refileOwnFood(child.id, fromId, toId))
      ) {
        outcome.refiled += 1;
      }
    }
  }

  // The seed re-stamps a kept spelling's language as it applies a file: the nightly refresh,
  // its validators forgotten, applies the file again. The boot downloads nothing.
  if (from < NORISH_LANGUAGES_FIRST_IN && (await readIngredientSeedState()).appliedAt) {
    await updateIngredientSeedState({ etag: null, lastModified: null });
  }

  return outcome;
}
