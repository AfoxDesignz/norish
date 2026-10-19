/**
 * The AI pass over Ingredients (ADR-0037, amended 2026-10-17): one job, one step per food, each
 * answer made as an AI Change. No person starts it: a mint queues it, and so does the nightly task.
 * A food passed over or whose question broke is recorded on its step; neither ends the pass.
 * Once it is over, the foods still there and showing no icon are queued on the icons queue, where
 * "Draw an icon" is on, so nothing is drawn for a food AI merged away.
 */

import type { Job } from "bullmq";

import type { IngredientReviewJobData } from "@norish/queue/contracts/job-types";
import type { ModelUse } from "@norish/shared-server/ai/runtime/model-use-ledger";
import type { ReviewOutcome } from "@norish/shared/contracts/ingredient-catalogue";
import { SERVER_CONFIG } from "@norish/config/env-config-server";
import {
  createModelUseLedger,
  recordModelUse,
  runWithModelUseLedger,
} from "@norish/shared-server/ai/runtime/model-use-ledger";
import { getAutomaticIngredientsConfig } from "@norish/shared-server/config/server-config-loader";
import { announcingTogether } from "@norish/shared-server/ingredients/changes";
import { listFoodsShowingNoIcon } from "@norish/shared-server/ingredients/icon-rounds";
import { askAIAbout } from "@norish/shared-server/ingredients/review";
import { createLogger } from "@norish/shared-server/logger";

import type { JobStepEvent } from "../job-steps";
import { createWorker } from "../create-worker";
import { addIngredientIconsJob } from "../ingredient-icons/producer";
import { recordCompletedSteps } from "../job-steps";
import { QUEUE_NAMES } from "../queue-names";
import { getQueues } from "../registry";

const log = createLogger("worker:ingredient-review");

/** The base id of every food's step; the food's place in the pass follows a colon. */
export const REVIEW_STEP = "asking-ai";

/** What a food's step records: the answer made and what AI was asked, a skip, or what broke. */
export type ReviewStepDetail = { ingredientId: string; name?: string } & (
  ReviewOutcome | { outcome: "failed"; error: string }
);

/** An error's message, with the cause a wrapper hides: a failed query names the database's complaint. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : null;

  return cause ? `${error.message}: ${cause}` : error.message;
}

/**
 * The question, asked of one food. Nothing here ends the pass: an error — the model, the
 * database — is recorded on the food's step for the monitor, so the other foods still get asked.
 */
async function ask(job: Job<IngredientReviewJobData>, ingredientId: string) {
  try {
    return { ingredientId, ...(await askAIAbout(ingredientId)) };
  } catch (error) {
    log.error({ err: error, jobId: job.id, ingredientId }, "Asking AI about a food failed");

    return { ingredientId, outcome: "failed" as const, error: describe(error) };
  }
}

/**
 * How many foods are asked about at once (`INGREDIENT_REVIEW_CONCURRENCY`). The questions are
 * independent; a self-hosted model that struggles with parallel requests gets a lower number.
 */
function reviewConcurrency(): number {
  return SERVER_CONFIG.INGREDIENT_REVIEW_CONCURRENCY;
}

/**
 * How many times a pass writes its answers down. A nightly pass may hold many foods, and the
 * job's progress is one value rewritten whole on each write, so twenty keep it linear.
 */
const PASS_WRITES = 20;

/** Queue the pass's foods that are still there and show no icon, where "Draw an icon" is on. */
async function queueIcons(ingredientIds: readonly string[]): Promise<void> {
  if (!(await getAutomaticIngredientsConfig()).icon) return;
  const foods = await listFoodsShowingNoIcon(ingredientIds);

  if (foods.length > 0) {
    await addIngredientIconsJob(getQueues().ingredientIcons, { ingredients: foods, actor: null });
  }
}

/** Exported so the job body can be exercised without a Redis-backed worker. */
export async function processIngredientReviewJob(
  job: Job<IngredientReviewJobData>,
  _token?: string,
  signal?: AbortSignal
): Promise<void> {
  const { ingredients: foods } = job.data;
  const writeEvery = Math.max(1, Math.ceil(foods.length / PASS_WRITES));
  let next = 0;
  let settled = 0;
  // The answers not yet written down, as the steps the job monitor shows.
  let unwritten: (JobStepEvent & { endedAt: number })[] = [];
  // Writes go out one after another, so the timeline keeps the order foods settled in.
  let recording = Promise.resolve();

  log.info({ jobId: job.id, count: foods.length }, "Asking AI about Ingredients");

  const record = (
    food: IngredientReviewJobData["ingredients"][number],
    startedAt: number,
    detail: ReviewStepDetail,
    models: ModelUse[]
  ) => {
    settled += 1;
    unwritten.push({
      id: `${REVIEW_STEP}:${settled}/${foods.length}`,
      startedAt,
      endedAt: Date.now(),
      detail: { ...detail, name: food.name },
      models,
    });
    if (unwritten.length < writeEvery && settled < foods.length) return recording;

    const steps = unwritten;

    unwritten = [];
    recording = recording.then(() => recordCompletedSteps(job, steps));

    return recording;
  };

  const askNext = async (): Promise<void> => {
    // A cancelled pass asks no further food.
    while (next < foods.length && !signal?.aborted) {
      const food = foods[next++]!;
      const startedAt = Date.now();
      // The food's own requests, so the monitor says what each food took; the
      // attempt's ledger gets them too.
      const own = createModelUseLedger();
      const detail = await runWithModelUseLedger(own, () => ask(job, food.id));

      for (const use of own.uses) recordModelUse(use);
      await record(food, startedAt, detail, own.uses);
    }
  };

  // What the pass changed is announced once, together, as it ends.
  await announcingTogether(() =>
    Promise.all(
      Array.from({ length: Math.min(reviewConcurrency(), foods.length) }, () => askNext())
    )
  );
  await recording;
  signal?.throwIfAborted();
  await queueIcons(foods.map((food) => food.id));
}

export function startIngredientReviewWorker(): void {
  createWorker<IngredientReviewJobData>(QUEUE_NAMES.INGREDIENT_REVIEW, processIngredientReviewJob);
}
