"use client";

import { createContext, useContext, ReactNode, useMemo, useCallback, useState } from "react";

import { FilterMode, SortOrder, SearchField, DEFAULT_SEARCH_FIELDS } from "@/types";

// Filter state for recipes
export type RecipeFilters = {
  rawInput: string;
  searchTags: string[];
  searchFields: SearchField[];
  filterMode: FilterMode;
  sortMode: SortOrder;
  showFavoritesOnly: boolean;
  minRating: number | null;
};

type FiltersCtx = {
  filters: RecipeFilters;
  setFilters: (filters: Partial<RecipeFilters>) => void;
  clearFilters: () => void;
  toggleSearchField: (field: SearchField) => void;
};

const RecipesFiltersContext = createContext<FiltersCtx | null>(null);

export function RecipesFiltersProvider({ children }: { children: ReactNode }) {
  // Filter state
  const [filters, setFiltersState] = useState<RecipeFilters>({
    rawInput: "",
    searchTags: [],
    searchFields: [...DEFAULT_SEARCH_FIELDS],
    filterMode: "AND",
    sortMode: "dateDesc",
    showFavoritesOnly: false,
    minRating: null,
  });

  const setFilters = useCallback((newFilters: Partial<RecipeFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState({
      rawInput: "",
      searchTags: [],
      searchFields: [...DEFAULT_SEARCH_FIELDS],
      filterMode: "AND",
      sortMode: "dateDesc",
      showFavoritesOnly: false,
      minRating: null,
    });
  }, []);

  // Toggle a search field on/off (fallback to defaults when trying to disable the last field)
  const toggleSearchField = useCallback((field: SearchField) => {
    setFiltersState((prev) => {
      const isEnabled = prev.searchFields.includes(field);

      if (isEnabled) {
        // When disabling the last field, reset to defaults instead
        if (prev.searchFields.length <= 1) {
          return { ...prev, searchFields: [...DEFAULT_SEARCH_FIELDS] };
        }
        return { ...prev, searchFields: prev.searchFields.filter((f) => f !== field) };
      } else {
        return { ...prev, searchFields: [...prev.searchFields, field] };
      }
    });
  }, []);

  const value = useMemo<FiltersCtx>(
    () => ({
      filters,
      setFilters,
      clearFilters,
      toggleSearchField,
    }),
    [filters, setFilters, clearFilters, toggleSearchField]
  );

  return <RecipesFiltersContext.Provider value={value}>{children}</RecipesFiltersContext.Provider>;
}

export function useRecipesFiltersContext() {
  const ctx = useContext(RecipesFiltersContext);

  if (!ctx) throw new Error("useRecipesFiltersContext must be used within RecipesFiltersProvider");

  return ctx;
}
