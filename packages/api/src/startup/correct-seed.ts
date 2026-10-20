import { correctSeedOnce } from "@norish/shared-server/ingredients/seed/correct-seed";
import { dbLogger as log } from "@norish/shared-server/logger";

/**
 * The seed's corrections, made once on an instance seeded before them (`correctSeedOnce`). A failure
 * never stops the server: the next boot tries again.
 */
export async function correctSeedOnBoot(): Promise<void> {
  try {
    const outcome = await correctSeedOnce();

    if (!outcome) log.info("Ingredient catalogue seed corrections already made");
  } catch (error) {
    log.warn(
      { err: error },
      "Correcting the ingredient catalogue seed failed; the next boot retries"
    );
  }
}
