import type { ReactNode } from "react";
import { ViewTransition } from "react";

/**
 * A recipe's picture as one object across a navigation: the card's image
 * carries into the recipe page's hero. Only the pair morphs (`default="none"`),
 * and globals.css skips the morph for readers who prefer reduced motion. An
 * inactive one keeps its place in the tree but claims no name, so of two
 * layouts mounted at once only the one on screen does.
 */
export function RecipeImageTransition({
  recipeId,
  active = true,
  children,
}: {
  recipeId: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <ViewTransition
      default="none"
      name={active ? `recipe-image-${recipeId}` : undefined}
      share="morph"
    >
      {children}
    </ViewTransition>
  );
}
