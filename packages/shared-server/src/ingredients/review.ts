/**
 * The AI pass over a food in the catalogue (ADR-0037): rung 3's thorough question, its answer made
 * as an AI Change; a split, tool or nothing only when sure. The review queue runs it.
 */
import type { FlagReason, ReviewOutcome } from "@norish/shared/contracts/ingredient-catalogue";
import {
  findCatalogueIngredient,
  setIngredientFlagReason,
} from "@norish/db/repositories/ingredient-catalogue";
import { stripPreparation } from "@norish/shared/lib/spelling-keys";

import type { AIResolution, AskTrace, NoFoodAnswer } from "../ai/resolution/ingredient-resolution";
import { askWhatFoodThisIs } from "../ai/resolution/ingredient-resolution";
import { deleteByAI, doubtOf, flagByAnswer, mergeByAI, parentByAI, splitByAI } from "./ai-changes";
import { ingredientChanges } from "./changes";
import { nameAfterAnswer } from "./plain-names";
import { resolveParts } from "./resolver";

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
  if (answer.kind === "several") return await split(row, answer, trace);
  if (answer.kind === "tool" || answer.kind === "nothing") {
    return await deleted(ingredientId, answer, trace);
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

/**
 * Several foods: the parts resolve as import resolves them, and the food's rows name them instead.
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

/** A tool or nothing: the food goes, and with nothing its lines go too as Junk Lines. */
async function deleted(
  ingredientId: string,
  answer: Extract<AIResolution, { kind: NoFoodAnswer }>,
  trace: AskTrace
): Promise<ReviewOutcome> {
  if (!answer.sure) return await doubted(ingredientId, doubtOf(answer.kind), trace);

  const { outcome, lines } = await deleteByAI(ingredientId, answer.kind);

  switch (outcome) {
    case "kept":
      return { outcome: "unsure", reason: doubtOf(answer.kind), ...trace };
    case "gone":
      return { outcome: "skipped", reason: "not-found", ...trace };
    case "decided":
    case "undone":
      return { outcome: "skipped", reason: outcome, ...trace };
    case "applied":
      return answer.kind === "tool"
        ? { outcome: "tool", ...trace }
        : { outcome: "junk", lines, ...trace };
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
