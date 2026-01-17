import type { PlannedRecipeDto, PlannedRecipeViewDto, Slot } from "@/types/dto/planned-recipe";

import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";

import { db } from "@/server/db/drizzle";
import { plannedRecipes, recipes } from "@/server/db/schema";
import { plannedRecipeViewSchema } from "@/server/db/zodSchemas";

export async function listPlannedRecipesByUserAndRange(
  userId: string,
  startISO: string,
  endISO: string
) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const rows = await db
    .select({
      id: plannedRecipes.id,
      userId: plannedRecipes.userId,
      recipeId: plannedRecipes.recipeId,
      date: sql<string>`to_char(${plannedRecipes.date}, 'YYYY-MM-DD')`,
      slot: plannedRecipes.slot,
      recipeName: recipes.name,
      recipeImage: recipes.image,
      servings: recipes.servings,
      calories: recipes.calories,
    })
    .from(plannedRecipes)
    .where(
      and(
        eq(plannedRecipes.userId, userId),
        gte(plannedRecipes.date, start as any),
        lte(plannedRecipes.date, end as any)
      )
    )
    .leftJoin(recipes, eq(recipes.id, plannedRecipes.recipeId))
    .orderBy(desc(plannedRecipes.date));

  return rows as unknown as (PlannedRecipeDto & {
    recipeName: string | null;
    recipeImage: string | null;
    servings: number | null;
    calories: number | null;
  })[];
}

export async function listPlannedRecipesByUsersAndRange(
  userIds: string[],
  startISO: string,
  endISO: string
) {
  if (!userIds.length)
    return [] as (PlannedRecipeDto & {
      recipeName: string | null;
      recipeImage: string | null;
      servings: number | null;
      calories: number | null;
    })[];

  const start = new Date(startISO);
  const end = new Date(endISO);
  const rows = await db
    .select({
      id: plannedRecipes.id,
      userId: plannedRecipes.userId,
      recipeId: plannedRecipes.recipeId,
      date: sql<string>`to_char(${plannedRecipes.date}, 'YYYY-MM-DD')`,
      slot: plannedRecipes.slot,
      recipeName: recipes.name,
      recipeImage: recipes.image,
      servings: recipes.servings,
      calories: recipes.calories,
    })
    .from(plannedRecipes)
    .where(
      and(
        inArray(plannedRecipes.userId, userIds),
        gte(plannedRecipes.date, start as any),
        lte(plannedRecipes.date, end as any)
      )
    )
    .leftJoin(recipes, eq(recipes.id, plannedRecipes.recipeId))
    .orderBy(desc(plannedRecipes.date));

  return rows as unknown as (PlannedRecipeDto & {
    recipeName: string | null;
    recipeImage: string | null;
    servings: number | null;
    calories: number | null;
  })[];
}

export async function getPlannedRecipeViewById(id: string): Promise<PlannedRecipeViewDto> {
  const [row] = await db
    .select({
      id: plannedRecipes.id,
      recipeId: plannedRecipes.recipeId,
      date: sql<string>`to_char(${plannedRecipes.date}, 'YYYY-MM-DD')`,
      slot: plannedRecipes.slot,
      recipeName: recipes.name,
      recipeImage: recipes.image,
      servings: recipes.servings,
      calories: recipes.calories,
    })
    .from(plannedRecipes)
    .leftJoin(recipes, eq(recipes.id, plannedRecipes.recipeId))
    .where(eq(plannedRecipes.id, id));

  if (!row) throw new Error("Planned recipe not found");
  const parsed = plannedRecipeViewSchema.safeParse(row);

  if (!parsed.success) {
    throw new Error("Planned recipe not found");
  }

  return parsed.data;
}

export async function createPlannedRecipe(
  id: string,
  userId: string,
  recipeId: string,
  date: string,
  slot: Slot
): Promise<PlannedRecipeViewDto> {
  const [inserted] = await db
    .insert(plannedRecipes)
    .values({
      id,
      userId,
      recipeId,
      date,
      slot,
    })
    .returning({ id: plannedRecipes.id });

  if (!inserted.id) throw new Error("Failed to create planned recipe");

  return await getPlannedRecipeViewById(inserted.id);
}

export async function deletePlannedRecipe(id: string) {
  await db.delete(plannedRecipes).where(eq(plannedRecipes.id, id));
}

export async function getRecipeIdFromPlannedRecipe(id: string) {
  const [row] = await db.select().from(plannedRecipes).where(eq(plannedRecipes.id, id));

  return row?.recipeId;
}

export async function updatePlannedRecipeDate(
  id: string,
  newDate: string
): Promise<PlannedRecipeViewDto> {
  await db
    .update(plannedRecipes)
    .set({
      date: newDate,
      updatedAt: new Date(),
    })
    .where(eq(plannedRecipes.id, id));

  return await getPlannedRecipeViewById(id);
}

export async function deletePlannedRecipesBefore(beforeDate: string): Promise<number> {
  const beforeDateObj = new Date(beforeDate);
  const result = await db
    .delete(plannedRecipes)
    .where(lte(plannedRecipes.date, beforeDateObj as any));

  return result.rowCount ?? 0;
}

export async function getPlannedRecipesByRecipeId(recipeId: string) {
  const rows = await db.select().from(plannedRecipes).where(eq(plannedRecipes.recipeId, recipeId));

  return rows;
}

export async function getFuturePlannedRecipes(fromDate: string) {
  const rows = await db
    .select()
    .from(plannedRecipes)
    .where(gte(plannedRecipes.date, fromDate as any));

  return rows;
}

/**
 * Get the owner userId for a planned recipe (for permission checks)
 */
export async function getPlannedRecipeOwnerId(plannedRecipeId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: plannedRecipes.userId })
    .from(plannedRecipes)
    .where(eq(plannedRecipes.id, plannedRecipeId))
    .limit(1);

  return row?.userId ?? null;
}
