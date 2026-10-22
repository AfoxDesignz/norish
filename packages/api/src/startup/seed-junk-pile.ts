import { seedJunkPileOnce } from "@norish/shared-server/ingredients/seed/junk-pile";
import { dbLogger as log } from "@norish/shared-server/logger";

/**
 * The junk pile's seed, once per version (`seedJunkPileOnce`), with or without a catalogue seed. A
 * failure never stops the server: the next boot tries again.
 */
export async function seedJunkPileOnBoot(): Promise<void> {
  try {
    const outcome = await seedJunkPileOnce();

    if (!outcome) log.info("Junk pile seed already applied");
  } catch (error) {
    log.warn({ err: error }, "Seeding the junk pile failed; the next boot retries");
  }
}
