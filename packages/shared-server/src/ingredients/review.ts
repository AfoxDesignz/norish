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
import { announcingAfter } from "./minted";
import { nameAfterAnswer } from "./plain-names";
import { resolveParts } from "./resolver";

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
  if (answer.kind === "several") return await announcingAfter(() => split(row, answer, trace));
  if (answer.kind === "not-a-food") {
    // A tool goes unsure too (Mike, ticket 08); an unsure "names nothing" is only flagged.
    return answer.sure || answer.tool
      ? await deleted(ingredientId, trace)
      : await doubted(ingredientId, "ai-junk", trace);
  }
  if (answer.kind === "unanswered") {
    if (answer.reason !== "ai-off") return await unanswered(ingredientId, answer.reason, trace);
    // AI was switched off meanwhile: a food waiting on this pass says so; another keeps its reason.
    if (row.flagReason === "ai-queued") await setIngredientFlagReason(ingredientId, "ai-off");

    return { outcome: "unsure", reason: "ai-off", ...trace };
  }

  const { sure } = answer;
  const parent = answer.parentId ? await findCatalogueIngredient(answer.parentId) : null;
  // A parent AI names that is not found drops the current one; a person's parent is never asked.
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
 * Several foods: a part AI found or picked is that food, the others rungs 1-2 or a mint (no slip),
 * and the food's rows name them instead; a part spelled by the food moves to the food named for it.
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

  const read = await resolveParts(
    answer.parts.map((part) => (part.found ? { ...part.found, text: part.text } : part.text)),
    { userId: food.ownerId },
    "split"
  );
  const parts = distinctFoods(read);
  const [first, ...rest] = parts;

  // Two parts spelled by the food itself would fold into one: which spelling is which is unknown.
  if (!first || read.filter((part) => part.ingredientId === food.id).length > 1) {
    return await doubted(food.id, "ai-unsure", trace);
  }

  const applied = await splitByAI(food.id, [first, ...rest], answer.joined);

  if (applied === "refused") return await doubted(food.id, "ai-unsure", trace);

  if (applied === "decided" || applied === "gone") {
    return { outcome: "skipped", reason: applied === "gone" ? "not-found" : applied, ...trace };
  }

  return { outcome: "split", into: parts.map((part) => part.text), ...trace };
}

/** Not a food: the food goes, and its rows keep their text. */
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
