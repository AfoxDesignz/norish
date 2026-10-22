import { addIngredientReviewJob } from "@norish/queue/ingredient-review/producer";
import { initializeQueues } from "@norish/queue/registry";
import { cleanUpCatalogueOnFirstStart } from "@norish/shared-server/ingredients/seed/first-start-cleanup";

import { runOnBoot } from "./run-on-boot";

/** The first start's catalogue cleanup, before traffic; the AI pass it queues starts the queues early. */
export async function cleanUpCatalogueOnBoot(): Promise<void> {
  await runOnBoot(
    () =>
      cleanUpCatalogueOnFirstStart(async (ingredientIds) => {
        await initializeQueues();
        await addIngredientReviewJob(ingredientIds);
      }),
    {
      skipped: "Ingredient catalogue already cleaned up for this release",
      failed: "Cleaning up the ingredient catalogue failed",
    }
  );
}
