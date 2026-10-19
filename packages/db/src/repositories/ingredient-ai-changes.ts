import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db, DbTransaction } from "@norish/db/drizzle";
import type { AIChangeUndo } from "@norish/db/schema";
import { db } from "@norish/db/drizzle";
import { ingredientAIChanges, ingredientAliases, ingredients } from "@norish/db/schema";
import { UNANSWERED_FLAG_REASONS } from "@norish/shared/contracts/ingredient-catalogue";

import { nameIsFree } from "./ingredient-catalogue";

/**
 * AI Changes (ADR-0037, amended 2026-10-17): written in the transaction that made them, kept or
 * undone by a person. The edit policy is checked in `@norish/shared-server/ingredients`.
 */

export type { AIChangeUndo };

/** One AI Change as Changed by AI lists it, with the food it is listed under and the one it names. */
export interface StoredAIChange {
  id: string;
  sure: boolean;
  kept: boolean;
  createdAt: Date;
  ingredient: { id: string; name: string; ownerId: string | null };
  target: { id: string; name: string } | null;
  undo: AIChangeUndo;
}

/** Record what AI just did, through the transaction that did it. */
export async function recordAIChange(
  tx: Db,
  change: { ingredientId: string; targetId?: string | null; sure: boolean; undo: AIChangeUndo }
): Promise<void> {
  await tx.insert(ingredientAIChanges).values({
    kind: change.undo.kind,
    ingredientId: change.ingredientId,
    targetId: change.targetId ?? null,
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
      undo: ingredientAIChanges.undo,
    })
    .from(ingredientAIChanges)
    .innerJoin(ingredients, eq(ingredients.id, ingredientAIChanges.ingredientId))
    .leftJoin(targets, eq(targets.id, ingredientAIChanges.targetId));
}

type ChangeRow = Awaited<ReturnType<typeof selectChanges>>[number];

function toStoredChange(row: ChangeRow): StoredAIChange {
  return {
    id: row.id,
    sure: row.sure,
    kept: row.keptAt !== null,
    createdAt: row.createdAt,
    ingredient: { id: row.ingredientId, name: row.ingredientName, ownerId: row.ingredientOwnerId },
    target: row.targetId && row.targetName ? { id: row.targetId, name: row.targetName } : null,
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

/** Flag the food while it has an open change or AI just doubted it (`unsure`); clear it otherwise. */
export async function refreshAIFlag(
  tx: Db,
  ingredientId: string,
  { unsure }: { unsure: boolean }
): Promise<void> {
  const flagged = sql`(${unsure} or ${hasOpenChange(ingredientId)})`;

  await tx
    .update(ingredients)
    .set({
      flagged,
      flagReason: sql`case when ${flagged} then 'ai-unsure' end`,
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
