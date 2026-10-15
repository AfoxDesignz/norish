"use client";

import { useHiddenItemVisibility } from "@/hooks/user/use-hidden-item-visibility";

import RecipeSkeletonDesktop from "./recipe-skeleton-desktop";
import RecipeSkeletonMobile from "./recipe-skeleton-mobile";

export type RecipeSkeletonParts = {
  showRatings: boolean;
  showNutrition: boolean;
  showFavorites: boolean;
  /** The app's own page: its back link, actions, cook and add-to-groceries buttons. */
  inApp: boolean;
};

/**
 * The recipe page's shape while it loads, without what the reader hid. A
 * shared recipe has no app controls, always shows its nutrition and never
 * its rating.
 */
export default function RecipeSkeleton({ shared = false }: { shared?: boolean }) {
  const shows = useHiddenItemVisibility();
  const parts: RecipeSkeletonParts = shared
    ? { showRatings: false, showNutrition: true, showFavorites: false, inApp: false }
    : {
        showRatings: shows.showRatings,
        showNutrition: shows.showNutrition,
        showFavorites: shows.showFavorites,
        inApp: true,
      };

  return (
    <>
      <div className="hidden md:block">
        <RecipeSkeletonDesktop {...parts} />
      </div>
      {/* The breakout each page gives its mobile layout, so the hero runs edge to edge. */}
      <div
        className={`-mx-4 flex w-[calc(100%+2rem)] flex-col md:hidden ${shared ? "-mt-4" : "-mt-10"}`}
      >
        <RecipeSkeletonMobile {...parts} />
      </div>
    </>
  );
}
