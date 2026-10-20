import { addIngredientReviewJob } from "@norish/queue/ingredient-review/producer";
import { initializeQueues } from "@norish/queue/registry";
import { cleanUpCatalogueOnFirstStart } from "@norish/shared-server/ingredients/seed/first-start-cleanup";
import { dbLogger as log } from "@norish/shared-server/logger";

/**
 * Clean up what earlier versions left in the catalogue, once per release that changes the cleanup
 * (ADR-0037), after the seed and the recheck, before traffic. The AI pass it queues needs the
 * queues, so they start early. A failure never stops the server; the next boot tries again.
 */
export async function cleanUpCatalogueOnBoot(): Promise<void> {
  try {
    const outcome = await cleanUpCatalogueOnFirstStart(async (ingredientIds) => {
      await initializeQueues();
      await addIngredientReviewJob(ingredientIds);
    });

    if (!outcome) log.info("Ingredient catalogue already cleaned up for this release");
  } catch (error) {
    log.warn({ err: error }, "Cleaning up the ingredient catalogue failed; the next boot retries");
  }
}
