/**
 * The AI pass over a food (ADR-0037): AI reads its name, the code looks the reading up, and the
 * answer is made as an AI Change. The review queue runs it.
 */
import type {
  FlagReason,
  ReviewOutcome,
  ReviewTrace,
} from "@norish/shared/contracts/ingredient-catalogue";
import {
  findCatalogueIngredient,
  setIngredientFlagReason,
} from "@norish/db/repositories/ingredient-catalogue";
import { noTrace } from "@norish/shared/contracts/ingredient-catalogue";
import { distinctFoods } from "@norish/shared/lib/line-foods";

import type { AIResolution } from "../ai/resolution/ingredient-resolution";
import { askWhatFoodThisIs } from "../ai/resolution/ingredient-resolution";
import { deleteByAI, flagByAnswer, mergeByAI, parentByAI, splitByAI } from "./ai-changes";
import { ingredientChanges } from "./changes";
import { nameAfterAnswer } from "./plain-names";
import { resolveIngredients } from "./resolver";

/** How long one food's question may take: up to three requests (read, Decision, language model). */
export const REVIEW_BUDGET_MS = 30_000;

export type { ReviewOutcome };

/** Ask AI what a food is and make the answer; a food not merged away then gets its Plain Name. */
export async function askAIAbout(ingredientId: string): Promise<ReviewOutcome> {
  const row = await findCatalogueIngredient(ingredientId);
  const trace = noTrace();

  if (!row) return { outcome: "skipped", reason: "not-found", ...trace };
  if (!row.askable) return { outcome: "skipped", reason: "decided", ...trace };

  const filedUnder = row.parentId ? await findCatalogueIngredient(row.parentId) : null;
  const answer = await askWhatFoodThisIs(row.name, {
    excludeId: ingredientId,
    filedUnder: filedUnder?.name ?? null,
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
  // No parent the catalogue has: the parent goes. A person's parent made the food unaskable, so it is not one.
  const { outcome: filed, previous } =
    parent || row.parentId
      ? await parentByAI(ingredientId, parent?.id ?? null, sure)
      : { outcome: null, previous: null };
  const dropped =
    !parent && filed === "applied" && previous ? await findCatalogueIngredient(previous) : null;

  if (filed === "decided") return { outcome: "skipped", reason: "decided", ...trace };
  if (filed !== "applied") await flagByAnswer(ingredientId, sure);
  if (filed === "undone") return { outcome: "skipped", reason: "undone", ...trace };

  const named = row.nameSettled ? null : await nameAfterAnswer(ingredientId);

  if (named) return { ...trace, ...named };
  if (parent && filed === "applied") return { outcome: "parent", of: parent.name, sure, ...trace };
  if (dropped) return { outcome: "no-parent", from: dropped.name, sure, ...trace };

  return sure
    ? { outcome: "distinct", ...trace }
    : { outcome: "unsure", reason: "ai-unsure", ...trace };
}

/**
 * Several foods: a part AI's names found is that food, the others resolve as an import resolves
 * them, and the food's rows name them instead. A part spelled by the food itself gets a food of its own.
 */
async function split(
  food: { id: string; ownerId: string | null },
  answer: Extract<AIResolution, { kind: "several" }>,
  trace: ReviewTrace
): Promise<ReviewOutcome> {
  if (!answer.sure) return await doubted(food.id, "ai-unsure", trace);
  // A person may have decided about the food while AI was asked: mint no parts for nothing.
  const now = await findCatalogueIngredient(food.id);

  if (!now?.askable) return { outcome: "skipped", reason: now ? "decided" : "not-found", ...trace };

  const unfound = answer.parts.filter((part) => !part.found).map((part) => part.text);
  const resolved = await resolveIngredients(unfound, { userId: food.ownerId });
  const read = answer.parts
    .map((part) => (part.found ? { ...part.found, text: part.text } : resolved.shift()))
    .filter((part) => part != null);
  const parts = distinctFoods(read);
  const [first, ...rest] = parts;

  // Two parts spelled by the food itself would fold into one: which spelling is which is unknown.
  if (!first || read.filter((part) => part.ingredientId === food.id).length > 1) {
    return await doubted(food.id, "ai-unsure", trace);
  }

  const applied = await splitByAI(food.id, [first, ...rest], answer.joined);

  if (applied === "decided" || applied === "gone") {
    return { outcome: "skipped", reason: applied === "gone" ? "not-found" : applied, ...trace };
  }

  return { outcome: "split", into: parts.map((part) => part.text), ...trace };
}

/** Not a food, sure or not: the food goes, and its rows keep their text. */
async function deleted(ingredientId: string, trace: ReviewTrace): Promise<ReviewOutcome> {
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
  trace: ReviewTrace
): Promise<ReviewOutcome> {
  await flagByAnswer(ingredientId, false, reason);

  return { outcome: "unsure", reason, ...trace };
}

/** No answer that changes anything: the food stays as it was, and its flag says why. */
async function unanswered(
  ingredientId: string,
  reason: FlagReason,
  trace: ReviewTrace
): Promise<ReviewOutcome> {
  await setIngredientFlagReason(ingredientId, reason);
  await ingredientChanges().changed([ingredientId]);

  return { outcome: "unsure", reason, ...trace };
}
