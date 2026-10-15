/**
 * New Ingredients Worker
 *
 * What the administrator turned on for foods just minted by someone's action
 * (Automatic for new ingredients): each food is given its Plain Name, then
 * drawn an icon where it would show none, so the icon is drawn from the name
 * it ends up with. Read the settings as the job runs, so one switched off
 * meanwhile stops. A food whose question or drawing fails is logged and left
 * as it was: the Clean names and Draw icons rounds still reach it. Its worker
 * wraps the processor so the models each food asks reach the job monitor.
 */

import type { Job } from "bullmq";

import type { NewIngredientsJobData } from "@norish/queue/contracts/job-types";
import { getAutomaticIngredientsConfig } from "@norish/shared-server/config/server-config-loader";
import { drawNewIngredientIcon } from "@norish/shared-server/ingredients/icon-rounds";
import { giveNewIngredientItsPlainName } from "@norish/shared-server/ingredients/plain-names";
import { createLogger } from "@norish/shared-server/logger";

import { createWorker } from "../create-worker";
import { reportStep } from "../job-steps";
import { QUEUE_NAMES } from "../queue-names";

const log = createLogger("worker:new-ingredients");

/** Exported so the job body can be exercised without a Redis-backed worker. */
export async function processNewIngredientsJob(
  job: Job<NewIngredientsJobData>,
  _token?: string,
  signal?: AbortSignal
): Promise<void> {
  const { plainName, icon } = await getAutomaticIngredientsConfig();

  for (const ingredientId of job.data.ingredientIds) {
    signal?.throwIfAborted();
    if (plainName) {
      await reportStep(job, "naming", { ingredientId });
      try {
        await giveNewIngredientItsPlainName(ingredientId);
      } catch (error) {
        log.warn({ err: error, jobId: job.id, ingredientId }, "Naming a new Ingredient failed");
      }
    }
    if (icon) {
      await reportStep(job, "drawing-icon", { ingredientId });
      try {
        await drawNewIngredientIcon(ingredientId);
      } catch (error) {
        log.warn({ err: error, jobId: job.id, ingredientId }, "Drawing a new Ingredient failed");
      }
    }
  }
}

export function startNewIngredientsWorker(): void {
  createWorker<NewIngredientsJobData>(QUEUE_NAMES.NEW_INGREDIENTS, processNewIngredientsJob);
}
