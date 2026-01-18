"use client";

import { createContext, useContext, ReactNode, useMemo, useState, useCallback } from "react";

import {
  useCalendarQuery,
  useCalendarMutations,
  useCalendarSubscription,
  type CalendarData,
} from "@/hooks/calendar";
import { Slot, CaldavItemType, CalendarItemViewDto } from "@/types";
import { dateKey, startOfMonth, endOfMonth, addMonths } from "@/lib/helpers";

type Ctx = {
  plannedItemsByDate: CalendarData;
  isLoading: boolean;
  planMeal: (
    date: string,
    slot: Slot,
    recipeId: string,
    recipeName: string,
    recipeImage: string | null,
    servings: number | null,
    calories: number | null,
    recipeTags?: string[]
  ) => void;
  planNote: (date: string, slot: Slot, title: string) => void;
  deletePlanned: (id: string, date: string, itemType: CaldavItemType) => void;
  updateItemDate: (id: string, oldDate: string, newDate: string, itemType: CaldavItemType) => void;
  updateItemSlot: (id: string, date: string, newSlot: Slot, itemType: CaldavItemType) => void;
  updateNoteTitle: (id: string, date: string, slot: Slot, title: string) => void;
  updateNote: (
    id: string,
    oldDate: string,
    oldSlot: Slot,
    newDate: string,
    newSlot: Slot,
    title: string
  ) => void;
};

const CalendarContext = createContext<Ctx | null>(null);

export function CalendarContextProvider({ children }: { children: ReactNode }) {
  // Default range: previous month to next month
  const [dateRange] = useState(() => {
    const now = new Date();

    return {
      start: startOfMonth(addMonths(now, -1)),
      end: endOfMonth(addMonths(now, 1)),
    };
  });

  const startISO = dateKey(dateRange.start);
  const endISO = dateKey(dateRange.end);

  const { calendarData, isLoading } = useCalendarQuery(startISO, endISO);
  const {
    createPlannedRecipe,
    deletePlannedRecipe,
    updatePlannedRecipeDate,
    createNote,
    deleteNote,
    updateNoteDate,
    updateNoteTitle,
    updateNote,
  } = useCalendarMutations(startISO, endISO);

  // Subscribe to WebSocket events (updates query cache via internal cache helpers)
  useCalendarSubscription();

  const planMeal = useCallback(
    (
      date: string,
      slot: Slot,
      recipeId: string,
      recipeName: string,
      recipeImage: string | null,
      servings: number | null,
      calories: number | null,
      recipeTags?: string[]
    ): void => {
      createPlannedRecipe(
        date,
        slot,
        recipeId,
        recipeName,
        recipeImage,
        servings,
        calories,
        recipeTags
      );
    },
    [createPlannedRecipe]
  );

  const planNote = useCallback(
    (date: string, slot: Slot, title: string): void => {
      createNote(date, slot, title);
    },
    [createNote]
  );

  const deletePlanned = useCallback(
    (id: string, date: string, itemType: CaldavItemType): void => {
      if (itemType === "recipe") {
        deletePlannedRecipe(id, date);
      } else {
        deleteNote(id, date);
      }
    },
    [deletePlannedRecipe, deleteNote]
  );

  const updateItemDate = useCallback(
    (id: string, oldDate: string, newDate: string, itemType: CaldavItemType): void => {
      if (itemType === "recipe") {
        updatePlannedRecipeDate(id, newDate, oldDate);
      } else {
        updateNoteDate(id, newDate, oldDate);
      }
    },
    [updatePlannedRecipeDate, updateNoteDate]
  );

  const updateItemSlot = useCallback(
    (id: string, date: string, newSlot: Slot, itemType: CaldavItemType): void => {
      // Find item to get details
      let item: CalendarItemViewDto | undefined;
      for (const d of Object.keys(calendarData)) {
        const found = calendarData[d]?.find((i) => i.id === id);
        if (found) {
          item = found;
          break;
        }
      }

      if (!item) return;

      if (itemType === "recipe" && item.itemType === "recipe") {
        deletePlannedRecipe(id, item.date);
        createPlannedRecipe(
          date,
          newSlot,
          item.recipeId,
          item.recipeName || "Recipe",
          item.recipeImage,
          item.servings ?? null,
          item.calories ?? null
        );
      } else if (itemType === "note" && item.itemType === "note") {
        deleteNote(id, item.date);
        createNote(date, newSlot, item.title || "Note");
      }
    },
    [calendarData, deletePlannedRecipe, createPlannedRecipe, deleteNote, createNote]
  );

  const value = useMemo<Ctx>(
    () => ({
      plannedItemsByDate: calendarData,
      isLoading,
      planMeal,
      planNote,
      deletePlanned,
      updateItemDate,
      updateItemSlot,
      updateNoteTitle,
      updateNote,
    }),
    [
      calendarData,
      isLoading,
      planMeal,
      planNote,
      deletePlanned,
      updateItemDate,
      updateItemSlot,
      updateNoteTitle,
      updateNote,
    ]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendarContext() {
  const ctx = useContext(CalendarContext);

  if (!ctx) throw new Error("useCalendarContext must be used within CalendarContextProvider");

  return ctx;
}
