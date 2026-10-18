import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import z from "zod";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { DbTransaction } from "@norish/db/drizzle";
import type { IngredientRef } from "@norish/db/repositories/ingredient-aliases";
import type { IngredientDto } from "@norish/shared/contracts/dto/ingredient";
import type { MeasurementSystem } from "@norish/shared/contracts/dto/recipe";
import type {
  RecipeIngredientInsertDto,
  RecipeIngredientsDto,
} from "@norish/shared/contracts/dto/recipe-ingredient";
import defaultUnits from "@norish/config/units.default.json";
import { ServerConfigKeys, UnitsConfigSchema } from "@norish/config/zod/server-config";
import { db } from "@norish/db/drizzle";
import { dbLogger } from "@norish/db/logger";
import { getConfig } from "@norish/db/repositories/server-config";
import { ingredients, recipeIngredientFoods, recipeIngredients } from "@norish/db/schema";
import { IngredientSelectBaseSchema } from "@norish/shared/contracts/zod";
import {
  RecipeIngredientInputSchema,
  RecipeIngredientSelectWithNameSchema,
  RecipeIngredientsInsertBaseSchema,
} from "@norish/shared/contracts/zod/recipe-ingredients";
import { lineNamesNoFood } from "@norish/shared/lib/ingredient-text";
import { normalizeUnit } from "@norish/shared/lib/unit-localization";

export async function getUnitsForNormalization(): Promise<UnitsMap> {
  const value = await getConfig<unknown>(ServerConfigKeys.UNITS);

  const wrapped = UnitsConfigSchema.safeParse(value);

  if (wrapped.success) {
    return wrapped.data.units;
  }

  return defaultUnits as UnitsMap;
}

export async function findIngredientById(id: string): Promise<IngredientDto | null> {
  const rows = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);
  const parsed = IngredientSelectBaseSchema.safeParse(rows[0]);

  return parsed.success ? parsed.data : null;
}

/**
 * What the ingredient resolver answered for a recipe's line texts: each text
 * as written, and the alias and Ingredient it resolved to, or null where it
 * names no food. The resolver lives above this package, so a recipe write is
 * handed its answers rather than minting anything itself; every line's text
 * must be here.
 */
export type IngredientResolutions = ReadonlyMap<string, IngredientRef | null>;

/**
 * What a recipe line is written with: its text as written, and the aliases
 * of the foods that text resolved to, in order. A line with no text is not a
 * line and is skipped; one that names no food (a heading, a text with no
 * letter or digit, a colon line with no amount) names none.
 */
export function resolvedRecipeLineValues(
  { ingredientName, amount }: { ingredientName?: string; amount?: unknown },
  resolutions: IngredientResolutions
): { name: string; aliasIds: string[] } | null {
  if (!ingredientName) return null;
  if (lineNamesNoFood({ text: ingredientName, amount })) {
    return { name: ingredientName, aliasIds: [] };
  }

  const resolved = resolutions.get(ingredientName);

  if (resolved === undefined)
    throw new Error(`Ingredient text was not resolved: ${ingredientName}`);

  return { name: ingredientName, aliasIds: resolved ? [resolved.aliasId] : [] };
}

/**
 * Keeps, of a join of `recipeIngredientFoods`, each line's first food: the
 * one a reader of "the line's food" reads. Columns by raw name, so the outer
 * row is never the subquery's own.
 */
export const isFirstLineFood = sql`not exists (select 1 from ${recipeIngredientFoods} earlier
  where earlier.recipe_ingredient_id = ${recipeIngredientFoods}.recipe_ingredient_id
    and earlier.position < ${recipeIngredientFoods}.position)`;

/** Write each line's foods in order, over the ones it had. */
export async function writeRecipeLineFoodsTx(
  tx: DbTransaction,
  lines: ReadonlyArray<{ id: string; aliasIds: readonly string[] }>
): Promise<void> {
  if (lines.length === 0) return;

  await tx.delete(recipeIngredientFoods).where(
    inArray(
      recipeIngredientFoods.recipeIngredientId,
      lines.map((line) => line.id)
    )
  );

  const rows = lines.flatMap(({ id, aliasIds }) =>
    aliasIds.map((ingredientAliasId, position) => ({
      recipeIngredientId: id,
      position,
      ingredientAliasId,
    }))
  );

  if (rows.length > 0) await tx.insert(recipeIngredientFoods).values(rows);
}

export async function attachIngredientsToRecipeByInputTx(
  tx: any,
  payloadIngredients: RecipeIngredientInsertDto[],
  resolutions: IngredientResolutions
): Promise<RecipeIngredientsDto[]> {
  if (!payloadIngredients?.length) return [];

  const parsedInput = z.array(RecipeIngredientInputSchema).safeParse(payloadIngredients);

  if (!parsedInput.success) {
    dbLogger.error({ err: parsedInput.error }, "Invalid RecipeIngredientsDto");
    throw new Error("Invalid RecipeIngredientsDto");
  }
  const items = parsedInput.data;

  // Get units config for normalization
  const units = await getUnitsForNormalization();

  const foods: Array<{ id: string; aliasIds: string[] }> = [];
  const rows = items.flatMap((ri) => {
    const line = resolvedRecipeLineValues(ri, resolutions);

    if (!line) return [];
    foods.push({ id: randomUUID(), aliasIds: line.aliasIds });

    return [
      {
        recipeId: ri.recipeId,
        name: line.name,
        amount: ri.amount != null ? Number(ri.amount) : null,
        unit: normalizeUnit(ri.unit ?? "", units), // ← Normalize unit to canonical ID
        order: ri.order,
        systemUsed: (ri.systemUsed as MeasurementSystem) || "metric",
      },
    ];
  });

  if (!rows.length) return [];

  const rowsSchema = z.array(RecipeIngredientsInsertBaseSchema);
  const validatedRows = rowsSchema.safeParse(rows);

  if (!validatedRows.success) {
    dbLogger.error({ err: validatedRows.error }, "Invalid recipeIngredients insert payload");
    throw new Error("Invalid recipeIngredients insert payload");
  }

  // Ids made here, so each line's foods are written against its own row.
  const inserted = await tx
    .insert(recipeIngredients)
    .values(validatedRows.data.map((row, index) => ({ ...row, id: foods[index]!.id })))
    .returning();

  await writeRecipeLineFoodsTx(tx, foods);

  const insertedWithNames = inserted.map((ri: any) => ({
    ...ri,
    ingredientId: resolutions.get(ri.name)?.ingredientId ?? null,
    amount: ri.amount != null ? Number(ri.amount) : null,
    ingredientName: ri.name,
    order: ri.order,
  }));

  const parsedInserted = z.array(RecipeIngredientSelectWithNameSchema).safeParse(insertedWithNames);

  if (!parsedInserted.success) {
    dbLogger.error({ err: parsedInserted.error }, "Failed to parse inserted ingredients");
    throw new Error("Failed to parse inserted ingredients");
  }

  return parsedInserted.data;
}
