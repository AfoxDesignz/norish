import { addIngredientReviewJob } from "@norish/queue/ingredient-review/producer";
import { initializeQueues } from "@norish/queue/registry";
import { cleanUpCatalogueOnFirstStart } from "@norish/shared-server/ingredients/seed/first-start-cleanup";
import { dbLogger as log } from "@norish/shared-server/logger";

/**
 * The first start's catalogue cleanup, before traffic; the AI pass it queues starts the queues early.
 * A failure never stops the server: the next boot tries again.
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
