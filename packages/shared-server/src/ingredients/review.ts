/**
 * The AI pass over a food already in the catalogue (ADR-0037, amended 2026-10-17): rung 3's
 * thorough question, its answer made as an AI Change (`ai-changes.ts`), sure or not.
 */
import type { FlaggedCatalogueIngredient } from "@norish/db/repositories/ingredient-catalogue";
import type {
  FlagReason,
  ModelTokenEstimate,
  ReviewOutcome,
  ReviewReport,
} from "@norish/shared/contracts/ingredient-catalogue";
import {
  findCatalogueIngredient,
  findCatalogueIngredientStates,
  listFlaggedCatalogueIngredients,
  setIngredientFlagReason,
} from "@norish/db/repositories/ingredient-catalogue";
import { getIngredientPermissionPolicy } from "@norish/shared-server/config/server-config-loader";
import { UNCHANGED_OUTCOMES } from "@norish/shared/contracts/ingredient-catalogue";
import { stripPreparation } from "@norish/shared/lib/spelling-keys";

import type { AskTrace } from "../ai/resolution/ingredient-resolution";
import type { CatalogueActor } from "./catalogue";
import { askWhatFoodThisIs, estimateQuestionTokens } from "../ai/resolution/ingredient-resolution";
import { estimatePlainNameTokens } from "../ai/resolution/plain-name";
import { flagByAnswer, mergeByAI, parentByAI } from "./ai-changes";
import { editableIngredient, mayEditIngredientRow } from "./catalogue";
import { ingredientChanges } from "./changes";
import { nameAfterAnswer } from "./plain-names";

/**
 * How long a person's question may take. Longer than an import's budget: the
 * language model may be asked twice, and the person asked for the wait.
 */
export const REVIEW_BUDGET_MS = 30_000;

export type { ReviewOutcome };

/** The Flagged Ingredients AI may ask about that the actor may edit, by name: what a round of Fix catalogue asks about. */
export async function listReviewableIngredients(
  actor: CatalogueActor
): Promise<FlaggedCatalogueIngredient[]> {
  const [rows, policy] = await Promise.all([
    listFlaggedCatalogueIngredients(),
    getIngredientPermissionPolicy(),
  ]);

  return rows.filter((row) => mayEditIngredientRow(policy.edit, actor, row.ownerId));
}

/** How many of a round's foods the estimate reads, spread over them: enough to even out their names. */
const ESTIMATE_SAMPLE = 5;

/** A few of a round's names, spread over them, for an estimate to read. */
export function estimateSample(names: readonly string[]): string[] {
  const every = Math.max(1, Math.floor(names.length / ESTIMATE_SAMPLE));

  return names.filter((_, index) => index % every === 0).slice(0, ESTIMATE_SAMPLE);
}

/**
 * About how many tokens one food's question takes on each model it asks,
 * counted from what would be sent for a few of these names, before any round
 * was measured.
 */
export async function estimateReviewTokens(
  names: readonly string[]
): Promise<ModelTokenEstimate[]> {
  return estimateQuestionTokens(
    estimateSample(names).map((text) => ({ text, bare: stripPreparation(text) }))
  );
}

/**
 * About how many tokens one food's question takes, counted from what would
 * be sent for a few of these names, before any round of Clean names was
 * measured.
 */
export async function estimateCleanTokens(names: readonly string[]): Promise<ModelTokenEstimate[]> {
  return estimatePlainNameTokens(estimateSample(names));
}

/** Ask AI what a food is and make the answer; a food not merged away then gets its Plain Name. */
export async function askAIAbout(
  actor: CatalogueActor,
  ingredientId: string
): Promise<ReviewOutcome> {
  const row = await editableIngredient(actor, ingredientId);
  const trace: AskTrace = { considered: [], englishName: null };

  if (!row.askable) return { outcome: "skipped", reason: "decided", ...trace };

  const answer = await askWhatFoodThisIs(row.name, stripPreparation(row.name), {
    excludeId: ingredientId,
    thorough: true,
    budgetMs: REVIEW_BUDGET_MS,
    trace,
  });

  if (answer.kind === "same") {
    const into = await findCatalogueIngredient(answer.ingredientId);
    const applied = into ? await mergeByAI(ingredientId, into.id, answer.sure) : "gone";

    if (applied === "undone") return { outcome: "skipped", reason: "undone", ...trace };
    if (!into || applied === "gone") return await unanswered(ingredientId, "food-gone", trace);

    return { outcome: "merge", into: into.name, sure: answer.sure, ...trace };
  }
  if (answer.reason !== null && answer.reason !== "ai-unsure") {
    return await unanswered(ingredientId, answer.reason, trace);
  }

  const sure = answer.reason === null;
  const parent = answer.kindOf ? await findCatalogueIngredient(answer.kindOf) : null;
  const filed = parent ? await parentByAI(ingredientId, parent.id, sure) : null;

  if (filed !== "applied") await flagByAnswer(ingredientId, sure);
  if (filed === "undone") return { outcome: "skipped", reason: "undone", ...trace };

  const named = row.nameSettled ? null : await nameAfterAnswer(ingredientId);

  if (named) return { ...trace, ...named };
  if (parent && filed === "applied") return { outcome: "parent", of: parent.name, sure, ...trace };

  return sure
    ? { outcome: "distinct", ...trace }
    : { outcome: "unsure", reason: "ai-unsure", ...trace };
}

/** No answer that changes anything: the food stays as it was, and its flag says why. */
async function unanswered(
  ingredientId: string,
  reason: FlagReason,
  trace: AskTrace
): Promise<ReviewOutcome> {
  await setIngredientFlagReason(ingredientId, reason);
  await ingredientChanges().changed([ingredientId]);

  return { outcome: "unsure", reason, ...trace };
}

/**
 * A finished round's report as it stands now. A food it made no change for
 * is listed while the question it was asked is still open: still flagged
 * after a review, still without a parent after a round of Find parents, its
 * name still unsettled after Clean names. One settled since, or gone, drops
 * out. A round still running is as it was.
 */
export async function withoutSettled(report: ReviewReport): Promise<ReviewReport> {
  if (!report.finished) return report;

  const unchanged = report.entries.filter((entry) => UNCHANGED_OUTCOMES.has(entry.outcome));
  const states = await findCatalogueIngredientStates(unchanged.map((entry) => entry.ingredientId));
  const open = ({ ingredientId, mode }: ReviewReport["entries"][number]) => {
    const state = states.get(ingredientId);

    if (!state) return false;

    switch (mode) {
      case "parent":
        return !state.parentId;
      case "name":
        return !state.nameSettled;
      default:
        return state.flagged;
    }
  };

  return {
    ...report,
    entries: report.entries.filter(
      (entry) => !UNCHANGED_OUTCOMES.has(entry.outcome) || open(entry)
    ),
  };
}
