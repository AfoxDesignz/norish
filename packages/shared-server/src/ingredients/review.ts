/**
 * The AI pass over a food already in the catalogue (ADR-0037, amended 2026-10-17): rung 3's
 * thorough question, its answer made as an AI Change, sure or not. The review queue runs it.
 */
import type { FlagReason, ReviewOutcome } from "@norish/shared/contracts/ingredient-catalogue";
import {
  findCatalogueIngredient,
  setIngredientFlagReason,
} from "@norish/db/repositories/ingredient-catalogue";
import { stripPreparation } from "@norish/shared/lib/spelling-keys";

import type { AskTrace } from "../ai/resolution/ingredient-resolution";
import { askWhatFoodThisIs } from "../ai/resolution/ingredient-resolution";
import { flagByAnswer, mergeByAI, parentByAI } from "./ai-changes";
import { ingredientChanges } from "./changes";
import { nameAfterAnswer } from "./plain-names";

/**
 * How long one food's question may take. Longer than an import's budget: the
 * language model may be asked twice, and nobody is waiting on the answer.
 */
export const REVIEW_BUDGET_MS = 30_000;

export type { ReviewOutcome };

/** Ask AI what a food is and make the answer; a food not merged away then gets its Plain Name. */
export async function askAIAbout(ingredientId: string): Promise<ReviewOutcome> {
  const row = await findCatalogueIngredient(ingredientId);
  const trace: AskTrace = { considered: [], englishName: null };

  if (!row) return { outcome: "skipped", reason: "not-found", ...trace };
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

    if (applied === "undone" || applied === "decided") {
      return { outcome: "skipped", reason: applied, ...trace };
    }
    if (!into || applied === "gone") return await unanswered(ingredientId, "food-gone", trace);

    return { outcome: "merge", into: into.name, sure: answer.sure, ...trace };
  }
  // AI was switched off meanwhile: the flag keeps saying why the food is still unanswered.
  if (answer.reason === "ai-off") return { outcome: "unsure", reason: "ai-off", ...trace };
  if (answer.reason !== null && answer.reason !== "ai-unsure") {
    return await unanswered(ingredientId, answer.reason, trace);
  }

  const sure = answer.reason === null;
  const parent = answer.kindOf ? await findCatalogueIngredient(answer.kindOf) : null;
  const filed = parent ? await parentByAI(ingredientId, parent.id, sure) : null;

  if (filed === "decided") return { outcome: "skipped", reason: "decided", ...trace };
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
