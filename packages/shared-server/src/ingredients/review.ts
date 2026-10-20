/**
 * The AI pass over a food in the catalogue (ADR-0037): AI reads the name once, the code looks the
 * reading up, and the answer is made as an AI Change; a split only when sure, not a food sure or
 * not. The review queue runs it.
 */
import type { FlagReason, ReviewOutcome } from "@norish/shared/contracts/ingredient-catalogue";
import {
  findCatalogueIngredient,
  setIngredientFlagReason,
} from "@norish/db/repositories/ingredient-catalogue";

import type { AIResolution, AskTrace } from "../ai/resolution/ingredient-resolution";
import { askWhatFoodThisIs } from "../ai/resolution/ingredient-resolution";
import { deleteByAI, flagByAnswer, mergeByAI, parentByAI, splitByAI } from "./ai-changes";
import { ingredientChanges } from "./changes";
import { nameAfterAnswer } from "./plain-names";
import { resolveParts } from "./resolver";

/** How long one food's question may take: AI may be asked twice, and nobody waits on it. */
export const REVIEW_BUDGET_MS = 30_000;

export type { ReviewOutcome };

/** Ask AI what a food is and make the answer; a food not merged away then gets its Plain Name. */
export async function askAIAbout(ingredientId: string): Promise<ReviewOutcome> {
  const row = await findCatalogueIngredient(ingredientId);
  const trace: AskTrace = { englishName: null, parts: null, considered: [] };

  if (!row) return { outcome: "skipped", reason: "not-found", ...trace };
  if (!row.askable) return { outcome: "skipped", reason: "decided", ...trace };

  const answer = await askWhatFoodThisIs(row.name, {
    excludeId: ingredientId,
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
  if (answer.kind === "several") return await split(row, answer, trace);
  if (answer.kind === "not-a-food") return await deleted(ingredientId, trace);
  // AI was switched off meanwhile: a food waiting on this pass says so; another keeps its reason.
  if (answer.reason === "ai-off") {
    if (row.flagReason === "ai-queued") await setIngredientFlagReason(ingredientId, "ai-off");

    return { outcome: "unsure", reason: "ai-off", ...trace };
  }
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

/**
 * Several foods: the parts resolve as an import resolves them, and the food's rows name them instead.
 * A part that is the food itself leaves it as it was.
 */
async function split(
  food: { id: string; ownerId: string | null },
  answer: Extract<AIResolution, { kind: "several" }>,
  trace: AskTrace
): Promise<ReviewOutcome> {
  if (!answer.sure) return await doubted(food.id, "ai-unsure", trace);
  // A person may have decided about the food while AI was asked: mint no parts for nothing.
  const now = await findCatalogueIngredient(food.id);

  if (!now?.askable) return { outcome: "skipped", reason: now ? "decided" : "not-found", ...trace };

  const parts = await resolveParts(answer.parts, { userId: food.ownerId });
  const [first, ...rest] = parts;

  if (!first || parts.some((part) => part.ingredientId === food.id)) {
    return await doubted(food.id, "ai-unsure", trace);
  }

  const applied = await splitByAI(food.id, [first, ...rest], answer.joined);

  if (applied === "decided" || applied === "gone") {
    return { outcome: "skipped", reason: applied === "gone" ? "not-found" : applied, ...trace };
  }

  return { outcome: "split", into: parts.map((part) => part.text), ...trace };
}

/** Not a food, sure or not: the food goes, and its rows keep their text. */
async function deleted(ingredientId: string, trace: AskTrace): Promise<ReviewOutcome> {
  const outcome = await deleteByAI(ingredientId);

  switch (outcome) {
    case "kept":
      return { outcome: "unsure", reason: "ai-junk", ...trace };
    case "gone":
      return { outcome: "skipped", reason: "not-found", ...trace };
    case "decided":
    case "undone":
      return { outcome: "skipped", reason: outcome, ...trace };
    case "applied":
      return { outcome: "not-a-food", ...trace };
  }
}

/** An answer AI was not sure of that would change too much to make: the food is flagged with it. */
async function doubted(
  ingredientId: string,
  reason: FlagReason,
  trace: AskTrace
): Promise<ReviewOutcome> {
  await flagByAnswer(ingredientId, false, reason);

  return { outcome: "unsure", reason, ...trace };
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
