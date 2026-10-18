import type { PantryIngredientDto } from "@norish/shared/contracts";
import { addPantryIngredient, findIngredientOwnSpelling } from "@norish/db/repositories/pantry";

import { resolveIngredient, typedParts, writeResolved } from "./resolver";

/** A Pantry Ingredient put in, and whether it is new or the one the household already had. */
export type PantryAdded = { item: PantryIngredientDto; created: boolean };

/**
 * Put what a member typed in the Pantry, resolved like a recipe line: a food per part its words
 * join (`typedParts`), the first under `id`. A food the household has answers `created: false`.
 */
export async function addToPantry(
  id: string,
  input: { userId: string; userIds: string[]; name: string }
): Promise<PantryAdded[]> {
  const [parts] = await typedParts([input.name]);
  const added: PantryAdded[] = [];

  for (const [index, name] of (parts ?? [input.name]).entries()) {
    const one = await writeResolved(
      () => resolveIngredient(name, { userId: input.userId }),
      async (resolved) =>
        resolved &&
        (await addPantryIngredient(index === 0 ? id : crypto.randomUUID(), {
          userId: input.userId,
          userIds: input.userIds,
          ingredientAliasId: resolved.aliasId,
          ingredientId: resolved.ingredientId,
        }))
    );

    if (one) added.push(one);
  }

  return added;
}

/**
 * Put a food a member picked in the Pantry as picked, under its own spelling; none where the
 * Ingredient is gone (merged away or deleted since it was picked).
 */
export async function addPickedToPantry(
  id: string,
  input: { userId: string; userIds: string[]; ingredientId: string }
): Promise<PantryAdded[]> {
  const spelling = await findIngredientOwnSpelling(input.ingredientId);

  if (!spelling) return [];

  return [
    await addPantryIngredient(id, {
      userId: input.userId,
      userIds: input.userIds,
      ...spelling,
    }),
  ];
}
