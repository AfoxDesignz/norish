import type { useTranslations } from "next-intl";
import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";

import type {
  ReviewOutcome,
  ReviewReportEntry,
  ReviewTrace,
} from "@norish/shared/contracts/ingredient-catalogue";
import { isCatalogueRefusal } from "@norish/shared/contracts/ingredient-catalogue";
import { ingredientDisplayName } from "@norish/shared/lib/ingredient-names";

import type { AIChange } from "./types";

type Translate = ReturnType<typeof useTranslations<"settings.ingredients">>;

/** What AI tried, so the viewer can judge its answer: what it read the name as, and what it compared it with. */
export function reviewTrace(t: Translate, outcome: ReviewTrace): string {
  const considered =
    outcome.considered.length > 0
      ? t("aiTrace.compared", { names: outcome.considered.slice(0, 8).join(", ") })
      : t("aiTrace.comparedNothing");

  return outcome.englishName
    ? `${t("aiTrace.readAs", { name: outcome.englishName })} ${considered}`
    : considered;
}

/** What asking AI about a food came to, in the viewer's words: the change it made, or why none. */
export function reviewMessage(t: Translate, name: string, outcome: ReviewOutcome): string {
  switch (outcome.outcome) {
    case "merge":
      return t("aiOutcomes.merge", { name, into: outcome.into });
    case "parent":
      return t("aiOutcomes.parent", { name, of: outcome.of });
    case "rename":
      return t("aiOutcomes.rename", { name, to: outcome.to });
    case "distinct":
      return t("aiOutcomes.distinct", { name });
    case "unsure":
      // A refused key is no doubt about the food: say what actually stopped AI.
      return outcome.reason === "ai-key-rejected"
        ? t("flagReasons.ai-key-rejected")
        : t("aiOutcomes.unsure", { name });
    case "skipped":
      return outcome.reason === "undone"
        ? t("aiOutcomes.undone", { name })
        : t("aiOutcomes.decided", { name });
  }
}

/** What an AI Change did to the food it is listed under, without the food's name. */
export function changeMessage(t: Translate, change: AIChange, locale: string): string {
  switch (change.kind) {
    case "merge":
      return t("changedByAI.merge", { from: change.from ?? "" });
    case "parent": {
      const of = change.target ? ingredientDisplayName(change.target, locale) : "";

      return change.fromWords
        ? t("changedByAI.parentFromName", { of })
        : t("changedByAI.parent", { of });
    }
    case "plain-name":
      return t("changedByAI.plainName", { from: change.from ?? "" });
  }
}

/** Why a round passed a food over, without the food's name. */
export function skippedReason(
  t: Translate,
  reason: Extract<ReviewReportEntry, { outcome: "skipped" }>["reason"]
): string {
  switch (reason) {
    case "settled":
      return t("skippedReasons.settled");
    case "decided":
      return t("skippedReasons.decided");
    case "undone":
      return t("skippedReasons.undone");
    case "forbidden":
      return t("skippedReasons.forbidden");
    case "not-found":
      return t("skippedReasons.notFound");
  }
}

/** Say why the server refused an edit to the catalogue, in the viewer's words. */
export function showRefusal(t: Translate, error: unknown, context: string): void {
  const refusal = error instanceof Error ? error.message : null;

  showSafeErrorToast({
    title: t("errors.title"),
    description: isCatalogueRefusal(refusal) ? t(`errors.${refusal}`) : t("errors.unknown"),
    error,
    context: `ingredients:${context}`,
  });
}
