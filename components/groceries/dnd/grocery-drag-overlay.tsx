"use client";

import type { GroceryDto, RecurringGroceryDto } from "@/types";

import { Checkbox } from "@heroui/react";
import { Bars3Icon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";

import { RecurrencePill } from "@/app/(app)/groceries/components/recurrence-pill";

interface GroceryDragOverlayProps {
  grocery: GroceryDto;
  recurringGrocery?: RecurringGroceryDto | null;
  recipeName?: string | null;
}

/**
 * Renders the grocery item in the DragOverlay.
 * This is what the user sees following their cursor during drag.
 */
export function GroceryDragOverlay({
  grocery,
  recurringGrocery,
  recipeName,
}: GroceryDragOverlayProps) {
  const t = useTranslations("groceries.item");
  const hasSubtitle = Boolean(recurringGrocery || recipeName);

  return (
    <div
      className="bg-content1 ring-primary/20 flex items-center gap-3 rounded-lg px-4 py-3 shadow-xl ring-2"
      style={{ minHeight: hasSubtitle ? 72 : 56 }}
    >
      {/* Drag handle visual (non-functional in overlay) */}
      <div className="text-default-400 flex h-8 w-8 items-center justify-center">
        <Bars3Icon className="h-5 w-5" />
      </div>

      {/* Checkbox visual (non-functional in overlay) */}
      <Checkbox isDisabled isSelected={grocery.isDone} radius="full" size="lg" />

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        {/* Main row: amount/unit + name */}
        <div className="flex w-full items-baseline gap-1.5">
          {(grocery.amount || grocery.unit) && (
            <span
              className={`shrink-0 font-medium ${
                grocery.isDone ? "text-default-400" : "text-primary"
              }`}
            >
              {formatAmountUnit(grocery)}
            </span>
          )}
          <span
            className={`truncate text-base ${
              grocery.isDone ? "text-default-400 line-through" : "text-foreground"
            }`}
          >
            {grocery.name || t("unnamedItem")}
          </span>
        </div>

        {/* Recipe name indicator */}
        {recipeName && !recurringGrocery && (
          <span className="text-default-400 mt-0.5 truncate text-xs">{recipeName}</span>
        )}

        {/* Recurring pill */}
        {recurringGrocery && (
          <RecurrencePill className="mt-0.5" recurringGrocery={recurringGrocery} />
        )}
      </div>
    </div>
  );
}

function formatAmountUnit(grocery: GroceryDto): string {
  const parts: string[] = [];

  if (grocery.amount && grocery.amount > 0) {
    const formattedAmount =
      grocery.amount % 1 === 0 ? grocery.amount.toString() : grocery.amount.toFixed(1);

    parts.push(formattedAmount);
  }

  if (grocery.unit) {
    parts.push(grocery.unit);
  }

  return parts.join(" ");
}
