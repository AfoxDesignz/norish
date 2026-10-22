import { findCatalogueIngredientNames } from "@norish/db/repositories/ingredient-catalogue";
import { isAIEnabled } from "@norish/shared-server/config/server-config-loader";

import { getQueues } from "../registry";

/**
 * Queue the AI pass over these foods: after a mint, and nightly for those AI could not answer
 * for. Nothing is queued while AI is off, or for a food gone since.
 */
export async function addIngredientReviewJob(ingredientIds: readonly string[]): Promise<void> {
  await addReviewJob(ingredientIds, "review");
}

/** Queue AI's check of the spellings added to these seeded foods (`checkSpellingsOf`), beside the pass. */
export async function addSpellingCheckJob(ingredientIds: readonly string[]): Promise<void> {
  await addReviewJob(ingredientIds, "check-spellings");
}

async function addReviewJob(ingredientIds: readonly string[], name: "review" | "check-spellings") {
  if (ingredientIds.length === 0 || !(await isAIEnabled())) return;
  const names = await findCatalogueIngredientNames(ingredientIds);
  const ingredients = [...names].map(([id, name]) => ({ id, name }));

  if (ingredients.length === 0) return;
  await getQueues().ingredientReview.add(
    name,
    name === "review" ? { ingredients } : { ingredients, check: "spellings" }
  );
}
