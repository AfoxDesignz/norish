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

import { parentFromWordsOf } from "../resolver";
import { oncePerVersion, SEED_CORRECTIONS_VERSION, SPELLING_MOVES } from "./catalogue-seed";

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

async function correctSeed(): Promise<CorrectionOutcome> {
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
        (await parentFromWordsOf(child.name)) === toId &&
        (await refileOwnFood(child.id, fromId, toId))
      ) {
        outcome.refiled += 1;
      }
    }
  }

  return outcome;
}
