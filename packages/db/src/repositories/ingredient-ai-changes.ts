import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db, DbTransaction } from "@norish/db/drizzle";
import type { AIChangeUndo, DeletedFood, DeletedLine } from "@norish/db/schema";
import type { FlagReason } from "@norish/shared/contracts/ingredient-catalogue";
import { db } from "@norish/db/drizzle";
import {
  groceries,
  ingredientAIChanges,
  ingredientAliases,
  ingredients,
  pantryIngredients,
  recipeIngredientFoods,
  recipeIngredients,
  recipes,
  recurringGroceries,
  users,
} from "@norish/db/schema";
import { UNANSWERED_FLAG_REASONS } from "@norish/shared/contracts/ingredient-catalogue";

import type { RecipeListContext } from "./recipes";
import { nameIsFree, rowsNaming } from "./ingredient-catalogue";
import { recordJunkLinesTx } from "./ingredients";
import { buildOwnerPolicyCondition } from "./recipes";

/**
 * AI Changes (ADR-0037, amended 2026-10-17): written in the transaction that made them, kept or
 * undone by a person. The edit policy is checked in `@norish/shared-server/ingredients`.
 */

export type { AIChangeUndo, DeletedFood, DeletedLine };

/**
 * One AI Change as Changed by AI lists it: the food it is listed under, the one it names, or the
 * recipe a Junk Line was deleted from. A deleted food's has none: its food is in `undo`.
 */
export interface StoredAIChange {
  id: string;
  sure: boolean;
  kept: boolean;
  createdAt: Date;
  ingredient: { id: string; name: string; ownerId: string | null } | null;
  target: { id: string; name: string } | null;
  recipe: { id: string; name: string; ownerId: string | null } | null;
  undo: AIChangeUndo;
}

/** Record what AI just did, through the transaction that did it. */
export async function recordAIChange(
  tx: Db,
  change: {
    ingredientId?: string | null;
    targetId?: string | null;
    recipeId?: string | null;
    sure: boolean;
    undo: AIChangeUndo;
  }
): Promise<void> {
  await tx.insert(ingredientAIChanges).values({
    kind: change.undo.kind,
    ingredientId: change.ingredientId ?? null,
    targetId: change.targetId ?? null,
    recipeId: change.recipeId ?? null,
    sure: change.sure,
    undo: change.undo,
  });
}

/** Record a parent a new food was given on a guess, from the words of its name or AI's unsure answer. */
export async function recordGuessedParent(
  tx: Db,
  ingredientId: string,
  parentId: string,
  from: "words" | "ai"
): Promise<void> {
  await recordAIChange(tx, {
    ingredientId,
    targetId: parentId,
    sure: false,
    undo: {
      kind: "parent",
      formerParentId: null,
      ...(from === "words" ? { fromWords: true } : {}),
    },
  });
}

const targets = alias(ingredients, "ai_change_targets");

/** How long Changed by AI lists a change a person has no more to do about. */
const LISTED_FOR = sql`interval '30 days'`;

/** Unsure, and neither kept nor undone: what flags its food. */
const open = and(
  eq(ingredientAIChanges.sure, false),
  isNull(ingredientAIChanges.keptAt),
  isNull(ingredientAIChanges.undoneAt)
);

/** Whether an open change is listed under the food. */
function hasOpenChange(ingredientId: string) {
  return sql`exists (select 1 from ${ingredientAIChanges} where ${and(
    eq(ingredientAIChanges.ingredientId, ingredientId),
    open
  )})`;
}

function selectChanges(tx: Db = db) {
  return tx
    .select({
      id: ingredientAIChanges.id,
      sure: ingredientAIChanges.sure,
      keptAt: ingredientAIChanges.keptAt,
      createdAt: ingredientAIChanges.createdAt,
      ingredientId: ingredients.id,
      ingredientName: ingredients.name,
      ingredientOwnerId: ingredients.ownerId,
      targetId: targets.id,
      targetName: targets.name,
      recipeId: recipes.id,
      recipeName: recipes.name,
      recipeOwnerId: recipes.userId,
      undo: ingredientAIChanges.undo,
    })
    .from(ingredientAIChanges)
    .leftJoin(ingredients, eq(ingredients.id, ingredientAIChanges.ingredientId))
    .leftJoin(targets, eq(targets.id, ingredientAIChanges.targetId))
    .leftJoin(recipes, eq(recipes.id, ingredientAIChanges.recipeId));
}

type ChangeRow = Awaited<ReturnType<typeof selectChanges>>[number];

function toStoredChange(row: ChangeRow): StoredAIChange {
  return {
    id: row.id,
    sure: row.sure,
    kept: row.keptAt !== null,
    createdAt: row.createdAt,
    ingredient:
      row.ingredientId && row.ingredientName !== null
        ? { id: row.ingredientId, name: row.ingredientName, ownerId: row.ingredientOwnerId }
        : null,
    target: row.targetId && row.targetName ? { id: row.targetId, name: row.targetName } : null,
    recipe:
      row.recipeId && row.recipeName !== null
        ? { id: row.recipeId, name: row.recipeName, ownerId: row.recipeOwnerId }
        : null,
    undo: row.undo,
  };
}

/** Open changes first, longest waiting first; then the last month's others, newest first. */
export async function listAIChanges(): Promise<StoredAIChange[]> {
  const rows = await selectChanges()
    .where(
      and(
        isNull(ingredientAIChanges.undoneAt),
        sql`(${open} or ${ingredientAIChanges.createdAt} > now() - ${LISTED_FOR})`
      )
    )
    .orderBy(
      desc(sql`${open}`),
      sql`case when ${open} then ${ingredientAIChanges.createdAt} end asc`,
      desc(ingredientAIChanges.createdAt),
      asc(ingredientAIChanges.id)
    );

  return rows.map(toStoredChange);
}

/**
 * Delete the changes Changed by AI no longer lists: sure or kept, and older than a month. An
 * undone one stays, as the memory AI checks, and an open one until a person handles it.
 */
export async function sweepAIChanges(): Promise<number> {
  const swept = await db
    .delete(ingredientAIChanges)
    .where(
      and(
        isNull(ingredientAIChanges.undoneAt),
        sql`not ${open}`,
        sql`${ingredientAIChanges.createdAt} <= now() - ${LISTED_FOR}`
      )
    )
    .returning({ id: ingredientAIChanges.id });

  return swept.length;
}

/** One change, locked for a Keep or an Undo; null where it is gone or already undone. */
export async function lockAIChange(tx: DbTransaction, id: string): Promise<StoredAIChange | null> {
  const [row] = await selectChanges(tx)
    .where(and(eq(ingredientAIChanges.id, id), isNull(ingredientAIChanges.undoneAt)))
    .for("update", { of: ingredientAIChanges });

  return row ? toStoredChange(row) : null;
}

/** Mark a change kept or undone. */
export async function settleAIChange(
  tx: DbTransaction,
  id: string,
  how: "kept" | "undone"
): Promise<void> {
  await tx
    .update(ingredientAIChanges)
    .set(how === "kept" ? { keptAt: new Date() } : { undoneAt: new Date() })
    .where(eq(ingredientAIChanges.id, id));
}

/** Keep every open change listed under a food: a person looked after it. */
export async function keepOpenAIChangesOf(tx: Db, ingredientId: string): Promise<void> {
  await tx
    .update(ingredientAIChanges)
    .set({ keptAt: new Date() })
    .where(and(eq(ingredientAIChanges.ingredientId, ingredientId), open));
}

/** Make a food's open changes sure: the seed vouched for the food, so none of them flags it. */
export async function vouchForOpenAIChanges(tx: Db, ingredientId: string): Promise<void> {
  await tx
    .update(ingredientAIChanges)
    .set({ sure: true })
    .where(and(eq(ingredientAIChanges.ingredientId, ingredientId), open));
}

/**
 * Drop a food's open parent changes, which a newer answer replaces; returns the parent the
 * oldest of them found the food under.
 */
export async function takeOpenParentChanges(
  tx: Db,
  ingredientId: string
): Promise<{ formerParentId: string | null } | null> {
  const taken = await tx
    .delete(ingredientAIChanges)
    .where(
      and(
        eq(ingredientAIChanges.ingredientId, ingredientId),
        eq(ingredientAIChanges.kind, "parent"),
        open
      )
    )
    .returning({ createdAt: ingredientAIChanges.createdAt, undo: ingredientAIChanges.undo });
  const [oldest] = taken.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return oldest?.undo.kind === "parent" ? { formerParentId: oldest.undo.formerParentId } : null;
}

/** A merge moves the source's merges into it, and parent changes naming it, to the target. */
export async function moveMergedAIChanges(
  tx: DbTransaction,
  sourceId: string,
  targetId: string
): Promise<void> {
  await tx
    .update(ingredientAIChanges)
    .set({ ingredientId: targetId })
    .where(
      and(eq(ingredientAIChanges.ingredientId, sourceId), eq(ingredientAIChanges.kind, "merge"))
    );
  await tx
    .update(ingredientAIChanges)
    .set({ targetId })
    .where(eq(ingredientAIChanges.targetId, sourceId));
}

/** Whether a person undid a merge of any of these spellings into `intoId`. */
export async function wasMergeUndone(
  tx: Db,
  intoId: string,
  aliasIds: readonly string[]
): Promise<boolean> {
  if (aliasIds.length === 0) return false;
  const [row] = await tx
    .select({ id: ingredientAIChanges.id })
    .from(ingredientAIChanges)
    .where(
      and(
        eq(ingredientAIChanges.ingredientId, intoId),
        eq(ingredientAIChanges.kind, "merge"),
        sql`${ingredientAIChanges.undoneAt} is not null`,
        sql`${ingredientAIChanges.undo} -> 'aliasIds' ?| ${sql`array[${sql.join(
          aliasIds.map((id) => sql`${id}`),
          sql`, `
        )}]::text[]`}`
      )
    )
    .limit(1);

  return row !== undefined;
}

/** Whether a person undid filing `ingredientId` under `parentId`. */
export async function wasParentUndone(
  tx: Db,
  ingredientId: string,
  parentId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ id: ingredientAIChanges.id })
    .from(ingredientAIChanges)
    .where(
      and(
        eq(ingredientAIChanges.ingredientId, ingredientId),
        eq(ingredientAIChanges.kind, "parent"),
        eq(ingredientAIChanges.targetId, parentId),
        sql`${ingredientAIChanges.undoneAt} is not null`
      )
    )
    .limit(1);

  return row !== undefined;
}

/**
 * Flag the food while it has an open change or AI just doubted it (`unsure`, for `reason`); clear
 * it otherwise.
 */
export async function refreshAIFlag(
  tx: Db,
  ingredientId: string,
  { unsure, reason = "ai-unsure" }: { unsure: boolean; reason?: FlagReason }
): Promise<void> {
  const flagged = sql`(${unsure} or ${hasOpenChange(ingredientId)})`;

  await tx
    .update(ingredients)
    .set({
      flagged,
      flagReason: sql`case when ${flagged} then ${unsure ? reason : "ai-unsure"} end`,
      version: sql`${ingredients.version} + 1`,
    })
    .where(eq(ingredients.id, ingredientId));
}

/** Flag the food an unsure change joined, keeping a reason that says no AI could answer for it. */
export async function flagUnderOpenChange(tx: Db, ingredientId: string): Promise<void> {
  await tx
    .update(ingredients)
    .set({
      flagged: true,
      flagReason: sql`case when ${inArray(ingredients.flagReason, [...UNANSWERED_FLAG_REASONS])} then ${ingredients.flagReason} else 'ai-unsure' end`,
      version: sql`${ingredients.version} + 1`,
    })
    .where(eq(ingredients.id, ingredientId));
}

/** Clear AI's doubt once no open change is left; a flag for another reason is not AI's to clear. */
export async function clearAIFlagUnlessOpen(tx: Db, ingredientId: string): Promise<void> {
  await tx
    .update(ingredients)
    .set({ flagged: false, flagReason: null, version: sql`${ingredients.version} + 1` })
    .where(
      and(
        eq(ingredients.id, ingredientId),
        eq(ingredients.flagReason, "ai-unsure"),
        sql`not ${hasOpenChange(ingredientId)}`
      )
    );
}

/** What undoing a merge of this food would need: its name, owner, parent and spellings. */
export async function readMergeUndo(
  tx: Db,
  sourceId: string
): Promise<Extract<AIChangeUndo, { kind: "merge" }> | null> {
  const [food] = await tx
    .select({
      name: ingredients.name,
      ownerId: ingredients.ownerId,
      parentId: ingredients.parentId,
    })
    .from(ingredients)
    .where(eq(ingredients.id, sourceId));

  if (!food) return null;
  const aliases = await tx
    .select({ id: ingredientAliases.id })
    .from(ingredientAliases)
    .where(eq(ingredientAliases.ingredientId, sourceId));

  return { kind: "merge", ...food, aliasIds: aliases.map((row) => row.id) };
}

/** Which of these spellings still belong to `ingredientId`. */
export async function aliasesStillOn(
  tx: Db,
  ingredientId: string,
  aliasIds: readonly string[]
): Promise<string[]> {
  if (aliasIds.length === 0) return [];
  const rows = await tx
    .select({ id: ingredientAliases.id })
    .from(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.ingredientId, ingredientId),
        inArray(ingredientAliases.id, [...aliasIds])
      )
    );

  return rows.map((row) => row.id);
}

/** Give a food back the name AI replaced, while it still has AI's name and the old one is free. */
export async function restoreName(
  tx: Db,
  ingredientId: string,
  { name, formerName }: { name: string; formerName: string }
): Promise<void> {
  await tx
    .update(ingredients)
    .set({ name: formerName, version: sql`${ingredients.version} + 1` })
    .where(
      and(
        eq(ingredients.id, ingredientId),
        eq(ingredients.name, name),
        nameIsFree(ingredientId, formerName)
      )
    );
}

/** The clean spellings, of these, a person put back as no Junk Line: AI never deletes them again. */
export async function findFoldsKeptAsNotJunk(
  folds: readonly string[],
  tx: Db = db
): Promise<Set<string>> {
  if (folds.length === 0) return new Set();
  const fold = sql<string>`${ingredientAIChanges.undo} -> 'line' ->> 'fold'`;
  const rows = await tx
    .select({ fold })
    .from(ingredientAIChanges)
    .where(
      and(
        eq(ingredientAIChanges.kind, "junk-line"),
        isNotNull(ingredientAIChanges.undoneAt),
        inArray(fold, [...folds])
      )
    );

  return new Set(rows.map((row) => row.fold));
}

/** Whether a person undid AI deleting this food, as a tool or as naming no food. */
export async function wasDeletionUndone(tx: Db, ingredientId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ingredientAIChanges.id })
    .from(ingredientAIChanges)
    .where(
      and(
        inArray(ingredientAIChanges.kind, ["tool", "not-a-food"]),
        isNotNull(ingredientAIChanges.undoneAt),
        sql`${ingredientAIChanges.undo} -> 'food' ->> 'ingredientId' = ${ingredientId}`
      )
    )
    .limit(1);

  return row !== undefined;
}

/** Whether a Pantry Ingredient names the food: AI never deletes one a person typed. */
export async function isInAnyPantry(tx: Db, ingredientId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: pantryIngredients.id })
    .from(pantryIngredients)
    .where(eq(pantryIngredients.ingredientId, ingredientId))
    .limit(1);

  return row !== undefined;
}

/** A food as Undo would mint it again: its spellings and every row naming it, read before it goes. */
export async function readDeletedFood(
  tx: DbTransaction,
  ingredientId: string
): Promise<DeletedFood | null> {
  const [food] = await tx
    .select({
      name: ingredients.name,
      ownerId: ingredients.ownerId,
      parentId: ingredients.parentId,
    })
    .from(ingredients)
    .where(eq(ingredients.id, ingredientId));

  if (!food) return null;
  const aliases = await tx
    .select({
      id: ingredientAliases.id,
      text: ingredientAliases.text,
      fold: ingredientAliases.fold,
      locale: ingredientAliases.locale,
      ownerId: ingredientAliases.ownerId,
    })
    .from(ingredientAliases)
    .where(eq(ingredientAliases.ingredientId, ingredientId));
  const naming = rowsNaming(ingredientId);
  const rowsOf = (table: typeof groceries | typeof recurringGroceries, where: SQL | undefined) =>
    tx.select({ id: table.id, aliasId: table.ingredientAliasId }).from(table).where(where);

  return {
    ingredientId,
    ...food,
    aliases,
    lineFoods: await tx
      .select({
        lineId: recipeIngredientFoods.recipeIngredientId,
        position: recipeIngredientFoods.position,
        aliasId: recipeIngredientFoods.ingredientAliasId,
      })
      .from(recipeIngredientFoods)
      .where(naming.lineFoods),
    groceries: await rowsOf(groceries, naming.groceries),
    recurring: await rowsOf(recurringGroceries, naming.recurringGroceries),
  };
}

/** The row's id where it is still there, so a restore never points at one deleted since. */
function stillThere(table: typeof users | typeof ingredients, id: string | null) {
  return id === null ? null : sql`(select id from ${table} where id = ${id})`;
}

/**
 * Mint a deleted food again under its ids, with the spellings still free, pointing back the rows
 * that named it and name nothing now; false where no spelling is free, throws where the name is taken.
 */
export async function restoreDeletedFood(tx: DbTransaction, food: DeletedFood): Promise<boolean> {
  await tx.insert(ingredients).values({
    id: food.ingredientId,
    name: food.name,
    ownerId: stillThere(users, food.ownerId),
    parentId: stillThere(ingredients, food.parentId),
  });
  const restored = await tx
    .insert(ingredientAliases)
    .values(
      food.aliases.map((spelling) => ({
        ...spelling,
        ingredientId: food.ingredientId,
        ownerId: stillThere(users, spelling.ownerId),
      }))
    )
    .onConflictDoNothing()
    .returning({ id: ingredientAliases.id });
  const back = new Set(restored.map((row) => row.id));

  if (back.size === 0) return false;
  for (const { lineId, position, aliasId } of food.lineFoods) {
    if (!back.has(aliasId)) continue;
    await tx.execute(sql`
      insert into ${recipeIngredientFoods} (recipe_ingredient_id, position, ingredient_alias_id)
      select id, ${position}, ${aliasId} from ${recipeIngredients} where id = ${lineId}
      on conflict do nothing`);
  }
  for (const [table, rows] of [
    [groceries, food.groceries],
    [recurringGroceries, food.recurring],
  ] as const) {
    for (const row of rows) {
      if (row.aliasId !== null && !back.has(row.aliasId)) continue;
      await tx
        .update(table)
        .set({
          ingredientAliasId: row.aliasId,
          ingredientId: food.ingredientId,
          version: sql`${table.version} + 1`,
        })
        .where(
          and(eq(table.id, row.id), isNull(table.ingredientAliasId), isNull(table.ingredientId))
        );
    }
  }

  return true;
}

/** Bump these recipes' versions: a line of theirs was deleted or put back. */
async function touchRecipes(tx: DbTransaction, recipeIds: readonly string[]): Promise<void> {
  if (recipeIds.length === 0) return;
  await tx
    .update(recipes)
    .set({ version: sql`${recipes.version} + 1`, updatedAt: new Date() })
    .where(inArray(recipes.id, [...new Set(recipeIds)]));
}

/**
 * Delete the lines naming this food and no other as Junk Lines, each recorded for Undo; with
 * `editableBy`, only in recipes that viewer may edit. Answers the lines deleted.
 */
export async function deleteJunkLines(
  tx: DbTransaction,
  ingredientId: string,
  { editableBy }: { editableBy?: RecipeListContext } = {}
): Promise<string[]> {
  const editable = editableBy
    ? await buildOwnerPolicyCondition(editableBy, recipes.userId, "edit")
    : undefined;
  const others = alias(recipeIngredientFoods, "other_line_foods");
  const otherSpellings = alias(ingredientAliases, "other_spellings");
  const rows = await tx
    .select({
      id: recipeIngredients.id,
      recipeId: recipeIngredients.recipeId,
      name: recipeIngredients.name,
      joined: recipeIngredients.joined,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
      order: recipeIngredients.order,
      systemUsed: recipeIngredients.systemUsed,
      aliasId: ingredientAliases.id,
      fold: ingredientAliases.fold,
    })
    .from(recipeIngredientFoods)
    .innerJoin(ingredientAliases, eq(ingredientAliases.id, recipeIngredientFoods.ingredientAliasId))
    .innerJoin(
      recipeIngredients,
      eq(recipeIngredients.id, recipeIngredientFoods.recipeIngredientId)
    )
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(
      and(
        eq(ingredientAliases.ingredientId, ingredientId),
        editable,
        notExists(
          tx
            .select({ one: sql`1` })
            .from(others)
            .innerJoin(otherSpellings, eq(otherSpellings.id, others.ingredientAliasId))
            .where(
              and(
                eq(others.recipeIngredientId, recipeIngredients.id),
                ne(otherSpellings.ingredientId, ingredientId)
              )
            )
        )
      )
    )
    .orderBy(asc(recipeIngredients.id), asc(recipeIngredientFoods.position));
  const lines = new Map<string, { recipeId: string; line: DeletedLine }>();

  for (const { recipeId, aliasId, ...row } of rows) {
    const held = lines.get(row.id);

    if (held) held.line.aliasIds.push(aliasId);
    else lines.set(row.id, { recipeId, line: { ...row, aliasIds: [aliasId] } });
  }
  if (lines.size === 0) return [];
  await tx.delete(recipeIngredients).where(inArray(recipeIngredients.id, [...lines.keys()]));
  await recordJunkLinesTx(tx, [...lines.values()]);
  await touchRecipes(
    tx,
    [...lines.values()].map((deleted) => deleted.recipeId)
  );

  return [...lines.keys()];
}

/** Put a deleted line back where it was, with those of its foods still there. */
export async function restoreDeletedLine(
  tx: DbTransaction,
  recipeId: string,
  line: DeletedLine
): Promise<void> {
  const { aliasIds, fold: _fold, ...row } = line;
  const there = aliasIds.length
    ? await tx
        .select({ id: ingredientAliases.id })
        .from(ingredientAliases)
        .where(inArray(ingredientAliases.id, aliasIds))
    : [];
  const foods = aliasIds.filter((id) => there.some((alias) => alias.id === id));
  const [inserted] = await tx
    .insert(recipeIngredients)
    .values({ ...row, recipeId, joined: foods.length > 1 ? row.joined : null })
    .onConflictDoNothing()
    .returning({ id: recipeIngredients.id });

  if (!inserted) return;
  if (foods.length > 0) {
    await tx.insert(recipeIngredientFoods).values(
      foods.map((ingredientAliasId, position) => ({
        recipeIngredientId: line.id,
        position,
        ingredientAliasId,
      }))
    );
  }
  await touchRecipes(tx, [recipeId]);
}
