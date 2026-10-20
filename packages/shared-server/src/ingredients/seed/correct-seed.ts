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
import { createLogger } from "@norish/shared-server/logger";
import { ingredients as ingredientsRealtime } from "@norish/shared-server/realtime/ingredients";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import { parentFromWordsOf } from "../resolver";
import {
  readIngredientSeedState,
  SEED_CORRECTIONS_VERSION,
  SPELLING_MOVES,
  updateIngredientSeedState,
} from "./catalogue-seed";

const log = createLogger("ingredient-seed");

/** Make the corrections where this version of them has not been made; null where it has. */
export async function correctSeedOnce(): Promise<{ moved: number; refiled: number } | null> {
  if ((await readIngredientSeedState()).correctionsVersion === SEED_CORRECTIONS_VERSION)
    return null;

  const seeded = await listSeededIngredientIds();
  const outcome = { moved: 0, refiled: 0 };

  for (const move of SPELLING_MOVES) {
    const fromId = seeded.get(move.from);
    const toId = seeded.get(move.to);

    if (!fromId || !toId) continue;
    for (const spelling of move.spellings) {
      if (await moveSeededSpelling(ingredientAliasFold(spelling), fromId, toId)) outcome.moved += 1;
    }
    for (const child of await listUnchosenOwnChildren(fromId)) {
      const parent = await parentFromWordsOf(child.name);

      if (parent?.id === toId && (await refileOwnFood(child.id, fromId, toId, !parent.sure))) {
        outcome.refiled += 1;
      }
    }
  }

  await updateIngredientSeedState({ correctionsVersion: SEED_CORRECTIONS_VERSION });
  log.info({ ...outcome, correctionsVersion: SEED_CORRECTIONS_VERSION }, "Seed corrections made");
  if (outcome.moved + outcome.refiled > 0) {
    await ingredientsRealtime.publish("changed", { ingredientIds: [] }, undefined);
  }

  return outcome;
}
