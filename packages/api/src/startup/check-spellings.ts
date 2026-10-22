import { addSpellingCheckJob } from "@norish/queue/ingredient-review/producer";
import { initializeQueues } from "@norish/queue/registry";
import { checkSpellingsOnFirstStart } from "@norish/shared-server/ingredients/spelling-check";
import { dbLogger as log } from "@norish/shared-server/logger";

/**
 * AI's check of the spellings added to seeded foods, queued once at the first start with AI on
 * (`checkSpellingsOnFirstStart`). A failure never stops the server: the next boot tries again.
 */
export async function checkSpellingsOnBoot(): Promise<void> {
  try {
    const outcome = await checkSpellingsOnFirstStart(async (ingredientIds) => {
      await initializeQueues();
      await addSpellingCheckJob(ingredientIds);
    });

    if (!outcome) log.info("Spellings added to seeded foods already checked, or AI is off");
  } catch (error) {
    log.warn({ err: error }, "Queueing AI's spelling check failed; the next boot retries");
  }
}
