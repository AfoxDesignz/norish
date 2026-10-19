import { findCatalogueIngredientNames } from "@norish/db/repositories/ingredient-catalogue";
import { isAIEnabled } from "@norish/shared-server/config/server-config-loader";

import { getQueues } from "../registry";

/**
 * Queue the AI pass over these foods: after a mint, and nightly for those AI could not answer
 * for. Nothing is queued while AI is off, or for a food gone since.
 */
export async function addIngredientReviewJob(ingredientIds: readonly string[]): Promise<void> {
  if (ingredientIds.length === 0 || !(await isAIEnabled())) return;
  const names = await findCatalogueIngredientNames(ingredientIds);
  const ingredients = [...names].map(([id, name]) => ({ id, name }));

  if (ingredients.length > 0) await getQueues().ingredientReview.add("review", { ingredients });
}
