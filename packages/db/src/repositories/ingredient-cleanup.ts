import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { DbTransaction } from "@norish/db/drizzle";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import { db } from "@norish/db/drizzle";
import {
  groceries,
  ingredientAliases,
  ingredients,
  recipeIngredientFoods,
  recipeIngredients,
  recipes,
  recurringGroceries,
} from "@norish/db/schema";

import { findGroceryRows, nameIsFree } from "./ingredient-catalogue";
import { writeRecipeLineFoodsTx } from "./ingredients";

/**
 * The first-start cleanup's reads and writes (ADR-0037): spellings cleaned in place, and the rows
 * a removed spelling named pointed at what their own text resolves to.
 */

/** One spelling as the cleanup reads it. */
export interface CleanupSpelling {
  id: string;
  text: string;
  fold: string;
  seeded: boolean;
  ingredientId: string;
}

/** Every spelling, oldest first, so the oldest of several with one clean name keeps it. */
export async function listSpellingsForCleanup(): Promise<CleanupSpelling[]> {
  return await db
    .select({
      id: ingredientAliases.id,
      text: ingredientAliases.text,
      fold: ingredientAliases.fold,
      seeded: ingredientAliases.seeded,
      ingredientId: ingredientAliases.ingredientId,
    })
    .from(ingredientAliases)
    .orderBy(asc(ingredientAliases.createdAt), asc(ingredientAliases.id));
}

/** Give a spelling another text and fold, where no other spelling has the fold; whether it did. */
export async function rewriteSpelling(
  id: string,
  { text, fold }: { text: string; fold: string }
): Promise<boolean> {
  const others = db
    .select({ id: ingredientAliases.id })
    .from(ingredientAliases)
    .where(and(eq(ingredientAliases.fold, fold), ne(ingredientAliases.id, id)));
  const rewritten = await db
    .update(ingredientAliases)
    .set({ text, fold, version: sql`${ingredientAliases.version} + 1`, updatedAt: new Date() })
    .where(and(eq(ingredientAliases.id, id), sql`not exists (${others})`))
    .returning({ id: ingredientAliases.id });

  return rewritten.length > 0;
}

/** The food a spelling is on and how many other spellings it has; null where the spelling is gone. */
export async function spellingsBeside(
  tx: DbTransaction,
  aliasId: string
): Promise<{ ingredientId: string; others: number } | null> {
  const [spelling] = await tx
    .select({ ingredientId: ingredientAliases.ingredientId })
    .from(ingredientAliases)
    .where(eq(ingredientAliases.id, aliasId));

  if (!spelling) return null;
  const [row] = await tx
    .select({ n: count() })
    .from(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.ingredientId, spelling.ingredientId),
        ne(ingredientAliases.id, aliasId)
      )
    );

  return { ingredientId: spelling.ingredientId, others: row?.n ?? 0 };
}

/** The food the spelling with `fold` is on, if any. */
export async function foodSpelled(tx: DbTransaction, fold: string): Promise<string | null> {
  const [row] = await tx
    .select({ ingredientId: ingredientAliases.ingredientId })
    .from(ingredientAliases)
    .where(eq(ingredientAliases.fold, fold));

  return row?.ingredientId ?? null;
}

/** A row a spelling named, with its own text and whose it is. */
export interface NamingRow {
  id: string;
  name: string | null;
  ownerId: string | null;
}

/** The recipe lines, Groceries and recurring groceries naming any of these spellings. */
export async function findRowsNamingSpellings(
  tx: DbTransaction,
  aliasIds: readonly string[]
): Promise<{
  lines: Array<NamingRow & { amount: string | null; unit: string | null }>;
  groceries: NamingRow[];
  recurring: NamingRow[];
}> {
  if (aliasIds.length === 0) return { lines: [], groceries: [], recurring: [] };
  const lines = await tx
    .selectDistinct({
      id: recipeIngredients.id,
      name: recipeIngredients.name,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
      ownerId: recipes.userId,
    })
    .from(recipeIngredientFoods)
    .innerJoin(
      recipeIngredients,
      eq(recipeIngredients.id, recipeIngredientFoods.recipeIngredientId)
    )
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(inArray(recipeIngredientFoods.ingredientAliasId, [...aliasIds]));
  const named = await findGroceryRows(tx, {
    groceries: inArray(groceries.ingredientAliasId, [...aliasIds]),
    recurring: inArray(recurringGroceries.ingredientAliasId, [...aliasIds]),
  });

  return { lines, ...named };
}

/** Point recipe lines at the foods their text resolved to, over the ones they had. */
export async function repointLines(
  tx: DbTransaction,
  lines: ReadonlyArray<{ id: string; aliasIds: readonly string[]; joined: LineJoin | null }>
): Promise<void> {
  await writeRecipeLineFoodsTx(tx, lines);
  for (const line of lines) {
    await tx
      .update(recipeIngredients)
      .set({ joined: line.joined, version: sql`${recipeIngredients.version} + 1` })
      .where(eq(recipeIngredients.id, line.id));
  }
}

/** Point Groceries or recurring groceries at what their text resolved to, or at no food. */
export async function repointGroceries(
  tx: DbTransaction,
  kind: "groceries" | "recurring",
  rows: ReadonlyArray<{ id: string; aliasId: string | null; ingredientId: string | null }>
): Promise<void> {
  const table = kind === "groceries" ? groceries : recurringGroceries;

  for (const row of rows) {
    await tx
      .update(table)
      .set({
        ingredientAliasId: row.aliasId,
        ingredientId: row.ingredientId,
        version: sql`${table.version} + 1`,
      })
      .where(eq(table.id, row.id));
  }
}

/** Every own Ingredient (no taxonomy entry) with its name, oldest first. */
export async function listOwnFoods(): Promise<Array<{ id: string; name: string }>> {
  return await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(isNull(ingredients.offId))
    .orderBy(asc(ingredients.createdAt), asc(ingredients.id));
}

/** Rename an own food to the clean name its name reduces to, unless a person named it or the name is taken. */
export async function renameFood(id: string, name: string): Promise<boolean> {
  const renamed = await db
    .update(ingredients)
    .set({ name, version: sql`${ingredients.version} + 1` })
    .where(and(eq(ingredients.id, id), eq(ingredients.nameChosen, false), nameIsFree(id, name)))
    .returning({ id: ingredients.id });

  return renamed.length > 0;
}
