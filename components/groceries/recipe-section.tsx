"use client";

import type { GroceryDto, StoreDto, RecurringGroceryDto } from "@/types";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { motion, Reorder } from "motion/react";
import { ChevronDownIcon, BookOpenIcon, TagIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";

import { GroceryItem } from "./grocery-item";
import { DraggableGroceryStoreItem } from "./draggable-grocery-store-item";

function sortGroceries(groceries: GroceryDto[], transitioningIds: Set<string>): GroceryDto[] {
  return [...groceries].sort((a, b) => {
    const aEffectiveDone = a.isDone && !transitioningIds.has(a.id);
    const bEffectiveDone = b.isDone && !transitioningIds.has(b.id);

    // Separate active and done items
    if (aEffectiveDone !== bEffectiveDone) {
      return aEffectiveDone ? 1 : -1;
    }

    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
}

// Delay before reordering after toggle (ms)
const REORDER_DELAY = 600;

interface RecipeSectionProps {
  recipeId: string | null; // null = Manual items
  recipeName: string;
  groceries: GroceryDto[];
  recurringGroceries: RecurringGroceryDto[];
  stores: StoreDto[];
  onToggle: (id: string, isDone: boolean) => void;
  onEdit: (grocery: GroceryDto) => void;
  onDelete: (id: string) => void;
  defaultExpanded?: boolean;
  // Drag and drop props
  isDraggingAny?: boolean;
  onDragStart?: (groceryId: string) => void;
  onDragEnd?: (pointerPosition: { x: number; y: number }) => void;
  onReorder?: (updates: { id: string; sortOrder: number }[], backendOnly?: boolean) => void;
  onDraggingInSection?: (isDragging: boolean) => void;
}

function RecipeSectionComponent({
  recipeId,
  recipeName,
  groceries,
  recurringGroceries,
  stores,
  onToggle,
  onEdit,
  onDelete,
  defaultExpanded = true,
  isDraggingAny = false,
  onDragStart,
  onDragEnd,
  onReorder,
  onDraggingInSection,
}: RecipeSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [hasDraggingItem, setHasDraggingItem] = useState(false);
  const t = useTranslations("groceries.store");

  // Track items that are transitioning (just toggled) - delay their reorder
  const [transitioningIds, setTransitioningIds] = useState<Set<string>>(new Set());
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup timeouts on unmount
  useEffect(() => {
    const timeouts = timeoutRefs.current;
    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, []);

  // Wrap onToggle to track transitioning items
  const handleToggle = useCallback(
    (id: string, isDone: boolean) => {
      // Call the actual toggle
      onToggle(id, isDone);

      // If checking off, add to transitioning set
      if (isDone) {
        setTransitioningIds((prev) => new Set(prev).add(id));

        // Clear any existing timeout for this id
        const existingTimeout = timeoutRefs.current.get(id);
        if (existingTimeout) clearTimeout(existingTimeout);

        // Remove from transitioning after delay
        const timeout = setTimeout(() => {
          setTransitioningIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          timeoutRefs.current.delete(id);
        }, REORDER_DELAY);

        timeoutRefs.current.set(id, timeout);
      }
    },
    [onToggle]
  );

  const activeCount = groceries.filter((g) => !g.isDone).length;
  const doneCount = groceries.filter((g) => g.isDone).length;

  // Handle reordering of items - updates visual order immediately
  const handleReorder = useCallback(
    (newOrder: GroceryDto[]) => {
      if (!onReorder) return;

      if (newOrder.length === 0) return;

      // Create updates with new sort order
      const updates = newOrder.map((grocery, index) => ({
        id: grocery.id,
        sortOrder: index,
      }));

      // Update optimistically (visual only, backend called on drag end)
      onReorder(updates, false);
    },
    [onReorder]
  );

  // Sort groceries using helper function
  const sortedGroceries = sortGroceries(groceries, transitioningIds);

  // Get store for a grocery
  const getStoreForGrocery = (grocery: GroceryDto): StoreDto | null => {
    if (!grocery.storeId) return null;
    return stores.find((s) => s.id === grocery.storeId) ?? null;
  };

  return (
    <motion.div className="relative" style={{ zIndex: hasDraggingItem ? 50 : 1 }}>
      <div
        className={`rounded-xl transition-all duration-200 ${isDraggingAny ? "overflow-visible" : "overflow-hidden"}`}
      >
        {/* Header */}
        <div
          className={`flex w-full items-center gap-3 px-4 py-3 ${
            recipeId ? "bg-primary-100 dark:bg-primary-900/30" : "bg-default-100"
          }`}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:opacity-90"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {/* Icon */}
            <div
              className={`shrink-0 rounded-full p-1.5 ${
                recipeId ? "bg-primary-500" : "bg-default-400"
              }`}
            >
              {recipeId ? (
                <BookOpenIcon className="h-4 w-4 text-white" />
              ) : (
                <TagIcon className="h-4 w-4 text-white" />
              )}
            </div>

            {/* Name and count */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-semibold">{recipeName}</span>
              <span className="text-default-400 shrink-0 text-sm">
                {activeCount > 0 && <span>{activeCount}</span>}
                {doneCount > 0 && (
                  <span className="text-default-300 ml-1">({t("done", { count: doneCount })})</span>
                )}
              </span>
            </div>

            {/* Expand/collapse chevron */}
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              className="text-default-400 shrink-0"
              transition={{ duration: 0.2 }}
            >
              <ChevronDownIcon className="h-5 w-5" />
            </motion.div>
          </button>
        </div>

        {/* Items */}
        {isExpanded && (
          <div className="divide-default-100 divide-y">
            {/* Active (not done) items - sortable */}
            <Reorder.Group
              axis="y"
              className="divide-default-100 divide-y"
              values={sortedGroceries.filter((g) => !g.isDone && !transitioningIds.has(g.id))}
              onReorder={handleReorder}
            >
              {sortedGroceries
                .filter((g) => !g.isDone && !transitioningIds.has(g.id))
                .map((grocery, index, array) => {
                  const recurringGrocery = grocery.recurringGroceryId
                    ? (recurringGroceries.find((r) => r.id === grocery.recurringGroceryId) ?? null)
                    : null;
                  const store = getStoreForGrocery(grocery);
                  const isFirst = index === 0;
                  const isLast = index === array.length - 1;
                  return (
                    <DraggableGroceryStoreItem
                      key={grocery.id}
                      grocery={grocery}
                      onDragEnd={(pointerPosition: { x: number; y: number }) => {
                        setHasDraggingItem(false);
                        onDraggingInSection?.(false);
                        onDragEnd?.(pointerPosition);
                      }}
                      onDragStart={(groceryId: string) => {
                        setHasDraggingItem(true);
                        onDraggingInSection?.(true);
                        onDragStart?.(groceryId);
                      }}
                    >
                      <GroceryItem
                        grocery={grocery}
                        recurringGrocery={recurringGrocery}
                        store={store}
                        onDelete={onDelete}
                        onEdit={onEdit}
                        onToggle={handleToggle}
                        isFirst={isFirst}
                        isLast={isLast}
                      />
                    </DraggableGroceryStoreItem>
                  );
                })}
            </Reorder.Group>

            {/* Done items - not sortable, just rendered */}
            {sortedGroceries
              .filter((g) => g.isDone || transitioningIds.has(g.id))
              .map((grocery, index, array) => {
                const recurringGrocery = grocery.recurringGroceryId
                  ? (recurringGroceries.find((r) => r.id === grocery.recurringGroceryId) ?? null)
                  : null;
                const store = getStoreForGrocery(grocery);
                const isFirst = index === 0;
                const isLast = index === array.length - 1;
                return (
                  <div key={grocery.id}>
                    <GroceryItem
                      grocery={grocery}
                      recurringGrocery={recurringGrocery}
                      store={store}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      onToggle={handleToggle}
                      isFirst={isFirst}
                      isLast={isLast}
                    />
                  </div>
                );
              })}

            {groceries.length === 0 && (
              <div className="text-default-400 px-4 py-6 text-center text-sm">{t("noItems")}</div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const RecipeSection = memo(RecipeSectionComponent);
