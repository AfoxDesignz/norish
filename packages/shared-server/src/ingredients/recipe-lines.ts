import type { RecipeLineAlias } from "@norish/db/repositories/ingredient-aliases";
import type { LineResolution } from "@norish/db/repositories/ingredients";
import type { MutationOutcome } from "@norish/db/repositories/mutation-outcomes";
import type {
  CreateRecipeResult,
  WithIngredientResolutions,
} from "@norish/db/repositories/recipes";
import type { FullRecipeInsertDTO, FullRecipeUpdateDTO } from "@norish/shared/contracts";
import {
  findIngredientNamesByIds,
  findRecipeLineAliases,
} from "@norish/db/repositories/ingredient-aliases";
import { createRecipeWithRefs, updateRecipeWithRefs } from "@norish/db/repositories/recipes";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { lineFoodText, lineNamesNoFood } from "@norish/shared/lib/ingredient-text";

import type { ResolveActor } from "./resolver";
import { cleanIngredientText, resolveLineFoods, writeResolved } from "./resolver";

interface RecipeLineInput {
  /** The stored line this one saves over, if any. */
  id?: string;
  ingredientId?: string | null;
  ingredientName?: string;
  amount?: unknown;
  unit?: string | null;
  /**
   * The text the line's food is resolved from, when an import already knows
   * which food the line is (Mealie's and Tandoor's own food names). The line
   * keeps its own text; this is read here and never stored.
   */
  foodText?: string;
}

/**
 * Resolve a recipe payload's line texts before the recipe is written, which
 * is the only way a recipe write accepts them. Each line's text is its
 * `ingredientName` as written; a line that names only an Ingredient by id is
 * given that Ingredient's name as its text. A line left with no text is
 * dropped, as the recipe write always skipped it, and one that names no
 * food (a heading, a text with no letter or digit, a colon line with no
 * amount) is written as it is. A line's food is resolved from the `foodText`
 * it names, else from `lineFoodText`; a text written twice is read the first
 * way. A line saved over one of `recipeId` keeps that line's food, or its
 * having none (its food deleted), while its `lineFoodText` is unchanged, so
 * only edited and new lines are resolved.
 */
export async function withResolvedIngredients<
  L extends RecipeLineInput,
  P extends { recipeIngredients?: L[] },
>(payload: P, actor: ResolveActor, recipeId?: string): Promise<WithIngredientResolutions<P>> {
  const lines = payload.recipeIngredients;

  if (!lines?.length) return { ...payload, ingredientResolutions: new Map() };

  const namesById = await findIngredientNamesByIds(
    lines.flatMap((line) =>
      !cleanIngredientText(line.ingredientName ?? "") && line.ingredientId
        ? [line.ingredientId]
        : []
    )
  );
  // A line whose text is markup alone names no food and is no line.
  const written = lines.flatMap((line) => {
    const text =
      cleanIngredientText(line.ingredientName ?? "") ||
      cleanIngredientText(namesById.get(line.ingredientId ?? "") ?? "");

    return text ? [{ ...line, ingredientName: text }] : [];
  });
  const units = await getUnits();
  const stored = recipeId
    ? await findRecipeLineAliases(written.flatMap((line) => (line.id ? [line.id] : [])))
    : new Map<string, RecipeLineAlias>();
  const resolved = new Map<string, LineResolution | null>();
  const foodTexts = new Map<string, string>();

  for (const line of written) {
    const kept = line.id ? stored.get(line.id) : undefined;

    if (
      kept &&
      kept.recipeId === recipeId &&
      lineFoodText({ text: kept.name, amount: kept.amount, unit: kept.unit }, units) ===
        lineFoodText({ text: line.ingredientName, amount: line.amount, unit: line.unit }, units) &&
      !resolved.has(line.ingredientName)
    ) {
      resolved.set(line.ingredientName, kept);
    }
  }
  for (const line of written) {
    const text = line.ingredientName;

    if (
      !lineNamesNoFood({ text, amount: line.amount }) &&
      !resolved.has(text) &&
      !foodTexts.has(text)
    ) {
      foodTexts.set(
        text,
        cleanIngredientText(line.foodText ?? "") ||
          lineFoodText({ text, amount: line.amount, unit: line.unit }, units)
      );
    }
  }

  const foods = await resolveLineFoods([...foodTexts.values()], actor);

  [...foodTexts.keys()].forEach((text, index) => resolved.set(text, foods[index] ?? null));

  return { ...payload, recipeIngredients: written, ingredientResolutions: resolved };
}

/**
 * Create a recipe with its lines resolved: the one way a recipe is written
 * from a payload. Resolved again should a food go away before the write.
 */
export function createResolvedRecipe(
  recipeId: string,
  userId: string | null | undefined,
  payload: FullRecipeInsertDTO,
  actor: ResolveActor
): Promise<CreateRecipeResult | null> {
  return writeResolved(
    () => withResolvedIngredients(payload, actor),
    (resolved) => createRecipeWithRefs(recipeId, userId, resolved)
  );
}

/** Update a recipe with its lines resolved, as `createResolvedRecipe` creates one. */
export function updateResolvedRecipe(
  recipeId: string,
  userId: string,
  payload: FullRecipeUpdateDTO,
  actor: ResolveActor,
  version?: number
): Promise<MutationOutcome<void>> {
  return writeResolved(
    () => withResolvedIngredients(payload, actor, recipeId),
    (resolved) => updateRecipeWithRefs(recipeId, userId, resolved, version)
  );
}
