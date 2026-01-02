"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useCallback } from "react";

import { useTRPC } from "@/app/providers/trpc-provider";
import { createClientLogger } from "@/lib/logger";

const log = createClientLogger("allergy-detection-query");

// Key for storing allergy detection recipe IDs in the query cache (shared state)
// Exported so other hooks can read from the same key
export const ALLERGY_DETECTION_RECIPES_KEY = ["recipes", "allergyDetection"];

/**
 * Hook that manages allergy detection recipe IDs state.
 *
 * - Hydrates from server on mount (fetches pending allergy detection jobs)
 * - Provides add/remove helpers for real-time updates
 * - Returns the current set of allergy detection recipe IDs
 *
 * Call this from useRecipesSubscription to hydrate on app load.
 * Use the returned helpers in subscription handlers.
 */
export function useAllergyDetectionQuery() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Fetch pending allergy detection jobs from server
  const {
    data: serverData,
    isLoading,
    error,
  } = useQuery({
    ...trpc.recipes.getPendingAllergyDetection.queryOptions(),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Local state query - this is the source of truth for the UI
  // Uses a stable queryFn that returns empty array as initial value
  const { data: localData } = useQuery({
    queryKey: ALLERGY_DETECTION_RECIPES_KEY,
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

    log.debug({ count: serverData.length }, "Hydrating allergy detection recipes from server");

    queryClient.setQueryData<string[]>(ALLERGY_DETECTION_RECIPES_KEY, (prev) => {
      const existing = prev ?? [];
      const merged = [...new Set([...existing, ...serverData])];

      return merged;
    });
  }, [serverData, queryClient]);

  const allergyDetectionRecipeIds = useMemo(() => new Set(localData ?? []), [localData]);

  const addAllergyDetectionRecipe = useCallback(
    (recipeId: string) => {
      queryClient.setQueryData<string[]>(ALLERGY_DETECTION_RECIPES_KEY, (prev) => {
        const arr = prev ?? [];

        if (arr.includes(recipeId)) return arr;

        return [...arr, recipeId];
      });
    },
    [queryClient]
  );

  const removeAllergyDetectionRecipe = useCallback(
    (recipeId: string) => {
      queryClient.setQueryData<string[]>(ALLERGY_DETECTION_RECIPES_KEY, (prev) => {
        const arr = prev ?? [];

        return arr.filter((id) => id !== recipeId);
      });
    },
    [queryClient]
  );

  return {
    allergyDetectionRecipeIds,
    addAllergyDetectionRecipe,
    removeAllergyDetectionRecipe,
    isLoading,
    error,
  };
}
