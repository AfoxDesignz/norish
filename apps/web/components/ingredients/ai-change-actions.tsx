"use client";

import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";

import type { AIChange } from "./types";
import { isOpenChange } from "./use-ai-changes";

/** Undo, and Keep while the change is open, for a change the viewer may act on. */
export function AIChangeActions({
  change,
  isDisabled = false,
  onKeep,
  onUndo,
}: {
  change: AIChange;
  isDisabled?: boolean;
  onKeep: (change: AIChange) => void;
  onUndo: (change: AIChange) => void;
}) {
  const t = useTranslations("settings.ingredients");

  if (!change.canAct) return null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        data-testid="ingredient-ai-change-undo"
        isDisabled={isDisabled}
        size="sm"
        variant="danger-soft"
        onPress={() => onUndo(change)}
      >
        {t("changedByAI.undo")}
      </Button>
      {isOpenChange(change) ? (
        <Button
          data-testid="ingredient-ai-change-keep"
          isDisabled={isDisabled}
          size="sm"
          variant="secondary"
          onPress={() => onKeep(change)}
        >
          {t("changedByAI.keep")}
        </Button>
      ) : null}
    </div>
  );
}
