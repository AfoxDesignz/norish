import type { IngredientRef } from "@norish/db/repositories/ingredient-aliases";
import { findGroceryFoods } from "@norish/db/repositories/groceries";
import { findRecipeLineAliases } from "@norish/db/repositories/ingredient-aliases";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import type { ResolveActor } from "./resolver";
import { cleanIngredientText, resolveIngredients } from "./resolver";

/** A grocery's name as written, the recipe line it was added from, and the grocery it edits, if any. */
export interface GroceryName {
  name: string | null;
  recipeIngredientId?: string | null;
  groceryId?: string | null;
}

/**
 * The alias each grocery's name resolves to, in order; null for a grocery
 * with no name. An edit that leaves a grocery's text alone keeps its food, or
 * its having none (its food deleted), so only a new text is a new question. A
 * grocery added from a recipe line under that line's own text takes the line's
 * alias, or its having none, so the list and the recipe agree on the food; one
 * whose text was changed on its way to the list is resolved from what it now
 * says. Everything else — typed by hand, repeating, replayed after being
 * added offline — is resolved like any recipe line.
 */
export async function resolveGroceryNames(
  items: readonly GroceryName[],
  actor: ResolveActor
): Promise<Array<IngredientRef | null>> {
  const [lines, edited] = await Promise.all([
    findRecipeLineAliases(
      items.flatMap((item) => (item.recipeIngredientId ? [item.recipeIngredientId] : []))
    ),
    findGroceryFoods(items.flatMap((item) => (item.groceryId ? [item.groceryId] : []))),
  ]);
  const texts = items.map((item) => cleanIngredientText(item.name ?? ""));
  const kept = items.map((item, index) => {
    const fold = texts[index] && ingredientAliasFold(texts[index]);
    const grocery = item.groceryId ? edited.get(item.groceryId) : undefined;
    const line = item.recipeIngredientId ? lines.get(item.recipeIngredientId) : undefined;

    if (!fold) return undefined;
    if (grocery && ingredientAliasFold(cleanIngredientText(grocery.name ?? "")) === fold) {
      return grocery;
    }

    return line && ingredientAliasFold(line.name) === fold ? line : undefined;
  });
  const toResolve = texts.filter((text, index) => text && !kept[index]);
  const answers = await resolveIngredients(toResolve, actor);
  const resolved = new Map(toResolve.map((text, index) => [text, answers[index]]));

  return texts.map((text, index) => {
    if (!text) return null;

    // A typed text that names no food (")") is kept on the list with none,
    // as is a kept grocery's or recipe line's whose food was deleted.
    const answer = kept[index] ? kept[index].food : resolved.get(text);

    return answer ? { aliasId: answer.aliasId, ingredientId: answer.ingredientId } : null;
  });
}

/**
 * The columns a grocery row keeps for the food its name names (ADR-0037): the
 * alias, and the alias's Ingredient beside it. Both null for a line with no
 * name.
 */
export interface GroceryIngredientColumns {
  ingredientAliasId: string | null;
  ingredientId: string | null;
}

export function ingredientColumns(ref: IngredientRef | null | undefined): GroceryIngredientColumns {
  return { ingredientAliasId: ref?.aliasId ?? null, ingredientId: ref?.ingredientId ?? null };
}

/**
 * One grocery name, typed or renamed, resolved to the columns its row keeps.
 * An edit names the grocery it edits, so one that leaves its text alone keeps
 * its food.
 */
export async function resolveGroceryName(
  grocery: GroceryName,
  actor: ResolveActor
): Promise<GroceryIngredientColumns> {
  const [ref] = await resolveGroceryNames([grocery], actor);

  return ingredientColumns(ref);
}
