"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useCallback } from "react";

import { useTRPC } from "@/app/providers/trpc-provider";
import { createClientLogger } from "@/lib/logger";

const log = createClientLogger("auto-tagging-query");

// Key for storing auto-tagging recipe IDs in the query cache (shared state)
// Exported so other hooks can read from the same key
export const AUTO_TAGGING_RECIPES_KEY = ["recipes", "autoTagging"];

/**
 * Hook that manages auto-tagging recipe IDs state.
 *
 * - Hydrates from server on mount (fetches pending auto-tagging jobs)
 * - Provides add/remove helpers for real-time updates
 * - Returns the current set of auto-tagging recipe IDs
 *
 * Call this from useRecipesSubscription to hydrate on app load.
 * Use the returned helpers in subscription handlers.
 */
export function useAutoTaggingQuery() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Fetch pending auto-tagging jobs from server
  const {
    data: serverData,
    isLoading,
    error,
  } = useQuery({
    ...trpc.recipes.getPendingAutoTagging.queryOptions(),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Local state query - this is the source of truth for the UI
  // Uses a stable queryFn that returns empty array as initial value
  const { data: localData } = useQuery({
    queryKey: AUTO_TAGGING_RECIPES_KEY,
    queryFn: () => [] as string[],
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Hydrate local state from server data
  useEffect(() => {
    if (!serverData || serverData.length === 0) return;

    log.debug({ count: serverData.length }, "Hydrating auto-tagging recipes from server");

    queryClient.setQueryData<string[]>(AUTO_TAGGING_RECIPES_KEY, (prev) => {
      const existing = prev ?? [];
      const merged = [...new Set([...existing, ...serverData])];

      return merged;
    });
  }, [serverData, queryClient]);

  const autoTaggingRecipeIds = useMemo(() => new Set(localData ?? []), [localData]);

  const addAutoTaggingRecipe = useCallback(
    (recipeId: string) => {
      queryClient.setQueryData<string[]>(AUTO_TAGGING_RECIPES_KEY, (prev) => {
        const arr = prev ?? [];

        if (arr.includes(recipeId)) return arr;

        return [...arr, recipeId];
      });
    },
    [queryClient]
  );

  const removeAutoTaggingRecipe = useCallback(
    (recipeId: string) => {
      queryClient.setQueryData<string[]>(AUTO_TAGGING_RECIPES_KEY, (prev) => {
        const arr = prev ?? [];

        return arr.filter((id) => id !== recipeId);
      });
    },
    [queryClient]
  );

  return {
    autoTaggingRecipeIds,
    addAutoTaggingRecipe,
    removeAutoTaggingRecipe,
    isLoading,
    error,
  };
}
