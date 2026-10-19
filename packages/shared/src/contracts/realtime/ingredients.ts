/**
 * Ingredients realtime catalogue. The catalogue of Ingredients is one for the
 * whole instance, so a change to what a spelling means is a broadcast. The
 * event names the Ingredients involved and nothing more: a client refetches
 * whatever it holds that is derived from them, so its own echo and a replay
 * off the Resume Buffer are a refetch that changes nothing.
 */

import { z } from "zod";

import { defineRealtimeCatalogue } from "./catalogue";

/**
 * How far a Draw icons round has come: how many foods it has settled of how
 * many, and what came of each: an icon drawn and set, a food passed over (out
 * of the asker's reach, gone, or given an icon of its own meanwhile), or a
 * drawing that failed, recorded on its own step. `pending` names the foods
 * still to be drawn, so each row shows its own turn. Broadcast like `changed`:
 * the catalogue and its icons are the instance's.
 */
export const IconRoundSchema = z.object({
  jobId: z.string(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  counts: z.object({
    drawn: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  pending: z.array(z.string()),
  finished: z.boolean(),
});

export type IconRound = z.infer<typeof IconRoundSchema>;

export const ingredientsRealtime = defineRealtimeCatalogue("ingredients", {
  /** Any edit to these Ingredients: what they are (a merge, an alias move, a rename, a parent, a deletion) or how they read (a spelling, a flag). */
  changed: { scope: "broadcast", payload: z.object({ ingredientIds: z.array(z.string()) }) },
  /** A Draw icons round moved on, or ended. */
  icons: { scope: "broadcast", payload: IconRoundSchema },
  /**
   * A member of the household corrected these Ingredients' nutrition, or
   * removed a correction (ADR-0039): only that household reads it, so only
   * it hears. Everything derived from their numbers is read again.
   */
  corrected: { scope: "household", payload: z.object({ ingredientIds: z.array(z.string()) }) },
});

export type IngredientsRealtime = typeof ingredientsRealtime;
