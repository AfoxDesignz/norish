import { addSpellingCheckJob } from "@norish/queue/ingredient-review/producer";
import { initializeQueues } from "@norish/queue/registry";
import { checkSpellingsOnFirstStart } from "@norish/shared-server/ingredients/spelling-check";

import { runOnBoot } from "./run-on-boot";

/** AI's check of the spellings added to seeded foods, queued once at the first start with AI on. */
export async function checkSpellingsOnBoot(): Promise<void> {
  await runOnBoot(
    () =>
      checkSpellingsOnFirstStart(async (ingredientIds) => {
        await initializeQueues();
        await addSpellingCheckJob(ingredientIds);
      }),
    {
      skipped: "Spellings added to seeded foods already checked, or AI is off",
      failed: "Queueing AI's spelling check failed",
    }
  );
}
