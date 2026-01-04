"use client";

import type { GroceryDto } from "@/types";
import type { ReactNode } from "react";

import { createContext, useContext, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import type {
  DndGroceryContextValue,
  DndGroceryProviderProps,
  ContainerId,
  ItemsState,
} from "./types";

import { GroceryDragOverlay } from "./grocery-drag-overlay";
import { useGroceryDnd } from "./use-grocery-dnd";

// =============================================================================
// Context
// =============================================================================

const DndGroceryContext = createContext<DndGroceryContextValue | null>(null);

export function useDndGroceryContext(): DndGroceryContextValue {
  const ctx = useContext(DndGroceryContext);
  if (!ctx) throw new Error("useDndGroceryContext must be used within DndGroceryProvider");
  return ctx;
}

// =============================================================================
// Provider Component
// =============================================================================

export function DndGroceryProvider({
  children,
  groceries,
  stores,
  recurringGroceries,
  onReorderInStore,
  getRecipeNameForGrocery,
}: DndGroceryProviderProps) {
  // =============================================================================
  // Sensors Configuration
  // =============================================================================

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // =============================================================================
  // DnD Hook
  // =============================================================================

  const {
    activeId,
    activeGrocery,
    activeRecurringGrocery,
    activeRecipeName,
    overContainerId,
    items,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    getItemsForContainer,
  } = useGroceryDnd({
    groceries,
    stores,
    recurringGroceries,
    onReorderInStore,
    getRecipeNameForGrocery,
  });

  // =============================================================================
  // Context Value
  // =============================================================================

  const contextValue = useMemo<DndGroceryContextValue>(
    () => ({
      activeId,
      activeGrocery,
      overContainerId,
      items,
      getItemsForContainer,
    }),
    [activeId, activeGrocery, overContainerId, items, getItemsForContainer]
  );

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <DndGroceryContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          },
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}

        <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
          {activeGrocery ? (
            <GroceryDragOverlay
              grocery={activeGrocery}
              recurringGrocery={activeRecurringGrocery}
              recipeName={activeRecipeName}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </DndGroceryContext.Provider>
  );
}
