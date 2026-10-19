import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { eq, getTableName, inArray, sql } from "drizzle-orm";
import z from "zod";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { DbTransaction } from "@norish/db/drizzle";
import type { IngredientRef } from "@norish/db/repositories/ingredient-aliases";
import type { DeletedLine } from "@norish/db/schema";
import type { IngredientDto } from "@norish/shared/contracts/dto/ingredient";
import type { MeasurementSystem } from "@norish/shared/contracts/dto/recipe";
import type {
  RecipeIngredientInsertDto,
  RecipeIngredientsDto,
} from "@norish/shared/contracts/dto/recipe-ingredient";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import defaultUnits from "@norish/config/units.default.json";
import { ServerConfigKeys, UnitsConfigSchema } from "@norish/config/zod/server-config";
import { db } from "@norish/db/drizzle";
import { dbLogger } from "@norish/db/logger";
import { getConfig } from "@norish/db/repositories/server-config";
import {
  ingredientAIChanges,
  ingredients,
  recipeIngredientFoods,
  recipeIngredients,
} from "@norish/db/schema";
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
 * The foods a line's text resolved to, in order, and how several go together; `junk` where AI is
 * sure it names nothing, a Junk Line no recipe stores, with the clean spelling it was read as.
 */
export interface LineResolution {
  foods: readonly IngredientRef[];
  joined: LineJoin | null;
  junk?: { fold: string };
}

/**
 * The resolver's answer for every line text of a recipe write, which mints nothing itself: the
 * foods each text names, or null for none.
 */
export type IngredientResolutions = ReadonlyMap<string, LineResolution | null>;

/**
 * A line's text, its foods' aliases and their join; null with no text, no foods for a heading, and
 * `junk` for a Junk Line, which the write leaves out and records as an AI Change.
 */
export function resolvedRecipeLineValues(
  { ingredientName, amount }: { ingredientName?: string; amount?: unknown },
  resolutions: IngredientResolutions
): { name: string; joined: LineJoin | null; aliasIds: string[]; junk: string | null } | null {
  if (!ingredientName) return null;
  if (lineNamesNoFood({ text: ingredientName, amount })) {
    return { name: ingredientName, joined: null, aliasIds: [], junk: null };
  }

  const resolved = resolutions.get(ingredientName);

  if (resolved === undefined)
    throw new Error(`Ingredient text was not resolved: ${ingredientName}`);

  return {
    name: ingredientName,
    joined: resolved?.joined ?? null,
    aliasIds: resolved?.foods.map((food) => food.aliasId) ?? [],
    junk: resolved?.junk?.fold ?? null,
  };
}

/** A Junk Line a write leaves out, as its AI Change keeps it for Undo. */
export function junkLine(
  row: {
    recipeId: string;
    name: string;
    amount: number | null;
    unit: string | null;
    order: number;
    systemUsed: MeasurementSystem;
  },
  fold: string,
  id: string = randomUUID()
): { recipeId: string; line: DeletedLine } {
  return {
    recipeId: row.recipeId,
    line: {
      id,
      name: row.name,
      joined: null,
      amount: row.amount?.toString() ?? null,
      unit: row.unit,
      order: row.order.toString(),
      systemUsed: row.systemUsed,
      aliasIds: [],
      fold,
    },
  };
}

/** Record the Junk Lines a write left out, each an AI Change Undo puts back where it was. */
export async function recordJunkLinesTx(
  tx: DbTransaction,
  junk: ReadonlyArray<{ recipeId: string; line: DeletedLine }>
): Promise<void> {
  if (junk.length === 0) return;
  await tx.insert(ingredientAIChanges).values(
    junk.map(({ recipeId, line }) => ({
      kind: "junk-line",
      recipeId,
      sure: true,
      undo: { kind: "junk-line" as const, line },
    }))
  );
}

/**
 * Keeps each line's first food of `foods`, the line foods table under its own name or an alias.
 * The outer rows are named by that name, so no bare column binds to the subquery's own table.
 */
export function isFirstLineFood(foods: PgTable = recipeIngredientFoods): SQL {
  const outer = sql.identifier(getTableName(foods));

  return sql`not exists (select 1 from ${recipeIngredientFoods} earlier
    where earlier.recipe_ingredient_id = ${outer}.recipe_ingredient_id
      and earlier.position < ${outer}.position)`;
}

/** A recipe line and the aliases of its foods, in order. */
export interface LineFoods {
  id: string;
  aliasIds: readonly string[];
}

/** Write each line's foods in order, over the ones it had. */
export async function writeRecipeLineFoodsTx(
  tx: DbTransaction,
  lines: readonly LineFoods[]
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

/** A recipe line to insert, and the aliases of its foods, in order. */
export interface NewRecipeLine {
  row: z.output<typeof RecipeIngredientsInsertBaseSchema>;
  aliasIds: readonly string[];
}

/**
 * Insert recipe lines with their foods, answering the rows inserted. Ids are made here, so each
 * line's foods are written against its own row.
 */
export async function insertRecipeLinesTx(
  tx: DbTransaction,
  lines: readonly NewRecipeLine[]
): Promise<Array<typeof recipeIngredients.$inferSelect>> {
  if (lines.length === 0) return [];

  const made = lines.map((line) => ({ ...line, id: randomUUID() }));
  const inserted = await tx
    .insert(recipeIngredients)
    .values(
      made.map(({ row, id }) => ({
        ...row,
        id,
        amount: row.amount?.toString() ?? null,
        order: row.order.toString(),
      }))
    )
    .onConflictDoNothing()
    .returning();
  const insertedIds = new Set(inserted.map((row) => row.id));

  await writeRecipeLineFoodsTx(
    tx,
    made.filter((line) => insertedIds.has(line.id))
  );

  return inserted;
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

  const junk: Array<{ recipeId: string; line: DeletedLine }> = [];
  const lines = items.flatMap((ri) => {
    const line = resolvedRecipeLineValues(ri, resolutions);

    if (!line) return [];

    const row = {
      recipeId: ri.recipeId,
      name: line.name,
      joined: line.joined,
      amount: ri.amount != null ? Number(ri.amount) : null,
      unit: normalizeUnit(ri.unit ?? "", units), // ← Normalize unit to canonical ID
      order: ri.order,
      systemUsed: (ri.systemUsed as MeasurementSystem) || "metric",
    };

    if (line.junk !== null) {
      if (row.recipeId) junk.push(junkLine({ ...row, recipeId: row.recipeId }, line.junk));

      return [];
    }

    return [{ row, aliasIds: line.aliasIds }];
  });

  await recordJunkLinesTx(tx, junk);
  if (!lines.length) return [];

  const rowsSchema = z.array(RecipeIngredientsInsertBaseSchema);
  const validatedRows = rowsSchema.safeParse(lines.map((line) => line.row));

  if (!validatedRows.success) {
    dbLogger.error({ err: validatedRows.error }, "Invalid recipeIngredients insert payload");
    throw new Error("Invalid recipeIngredients insert payload");
  }

  const inserted = await insertRecipeLinesTx(
    tx,
    validatedRows.data.map((row, index) => ({ row, aliasIds: lines[index]!.aliasIds }))
  );

  if (!inserted.length) return [];

  const insertedWithNames = inserted.map((ri: any) => ({
    ...ri,
    ingredientId: resolutions.get(ri.name)?.foods[0]?.ingredientId ?? null,
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
