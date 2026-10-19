/**
 * AI Changes (CONTEXT.md; ADR-0037, amended 2026-10-17): AI's merge, parent or Plain Name, made
 * and recorded in one transaction, kept or undone by a person under `edit` on the food it was about.
 */
import type { DbTransaction } from "@norish/db/drizzle";
import type { StoredAIChange } from "@norish/db/repositories/ingredient-ai-changes";
import type { AIChangeKind } from "@norish/shared/contracts/ingredient-catalogue";
import type { LocaleNames } from "@norish/shared/lib/ingredient-names";
import { withTransaction } from "@norish/db/drizzle";
import {
  aliasesStillOn,
  clearAIFlagUnlessOpen,
  flagUnderOpenChange,
  listAIChanges,
  lockAIChange,
  readMergeUndo,
  recordAIChange,
  refreshAIFlag,
  restoreName,
  settleAIChange,
  takeOpenParentChanges,
  wasMergeUndone,
  wasParentUndone,
} from "@norish/db/repositories/ingredient-ai-changes";
import { findLocaleNames } from "@norish/db/repositories/ingredient-aliases";
import {
  isAskableByAI,
  keepIngredientDistinct,
  settleIngredientName,
} from "@norish/db/repositories/ingredient-catalogue";
import {
  findIngredientAncestors,
  insertCatalogueIngredient,
  lockIngredients,
  lockTree,
  mergeCatalogueIngredients,
  moveCatalogueAlias,
  setCatalogueIngredientParent,
} from "@norish/db/repositories/ingredient-relocation";
import { getIngredientPermissionPolicy } from "@norish/shared-server/config/server-config-loader";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import type { CatalogueActor, CatalogueEdit } from "./catalogue";
import { assertMayEdit, inEdit, mayEditIngredientRow, refusedOn } from "./catalogue";
import { ingredientChanges } from "./changes";

/**
 * What applying AI's answer came to: made, refused as a change a person undid, a food a person
 * decided about while AI was asking, or a food gone.
 */
export type ApplyOutcome = "applied" | "undone" | "decided" | "gone";

async function announceIfApplied(
  outcome: ApplyOutcome,
  changed: Array<string | null>
): Promise<ApplyOutcome> {
  if (outcome === "applied") {
    await ingredientChanges().changed(changed.filter((id): id is string => id !== null));
  }

  return outcome;
}

/** Merge `sourceId` into `targetId`, keeping the target's own flag; an unsure merge flags it. */
export async function mergeByAI(sourceId: string, targetId: string, sure: boolean) {
  const outcome = await withTransaction(async (tx): Promise<ApplyOutcome> => {
    await lockTree(tx);
    if ((await lockIngredients(tx, [sourceId, targetId])) < 2) return "gone";
    if (!(await isAskableByAI(tx, sourceId))) return "decided";
    const undo = await readMergeUndo(tx, sourceId);

    if (!undo) return "gone";
    if (await wasMergeUndone(tx, targetId, undo.aliasIds)) return "undone";
    await mergeCatalogueIngredients(tx, sourceId, targetId, { keepFlag: true });
    await recordAIChange(tx, { ingredientId: targetId, sure, undo });
    if (!sure) await flagUnderOpenChange(tx, targetId);

    return "applied";
  });

  return await announceIfApplied(outcome, [sourceId, targetId]);
}

/**
 * File a food under `parentId`, leaving the parent unchosen. It replaces the food's open parent
 * changes, so its Undo goes back to where the oldest of them found the food.
 */
export async function parentByAI(ingredientId: string, parentId: string, sure: boolean) {
  let previous: string | null = null;
  const outcome = await withTransaction(async (tx): Promise<ApplyOutcome> => {
    await lockTree(tx);
    if ((await lockIngredients(tx, [ingredientId, parentId])) < 2) return "gone";
    if (!(await isAskableByAI(tx, ingredientId))) return "decided";
    if (await wasParentUndone(tx, ingredientId, parentId)) return "undone";

    const ancestors = await findIngredientAncestors([ingredientId, parentId], tx);

    if (ancestors.get(parentId)?.includes(ingredientId)) return "gone";
    previous = ancestors.get(ingredientId)?.[0] ?? null;
    const replaced = await takeOpenParentChanges(tx, ingredientId);

    if (previous !== parentId) {
      await setCatalogueIngredientParent(tx, ingredientId, parentId, { byAI: true });
    }
    if (previous !== parentId || replaced) {
      await recordAIChange(tx, {
        ingredientId,
        targetId: parentId,
        sure,
        undo: { kind: "parent", formerParentId: replaced ? replaced.formerParentId : previous },
      });
    }
    await refreshAIFlag(tx, ingredientId, { unsure: !sure });

    return "applied";
  });

  return await announceIfApplied(outcome, [ingredientId, previous, parentId]);
}

/** Rename a food to its Plain Name, which settles it; false where it was settled or taken meanwhile. */
export async function renameByAI(ingredientId: string, formerName: string, name: string) {
  const renamed = await withTransaction(async (tx) => {
    const plain = { text: name, fold: ingredientAliasFold(name) };

    if ((await lockIngredients(tx, [ingredientId])) < 1) return false;
    if (!(await isAskableByAI(tx, ingredientId))) return false;
    if (!(await settleIngredientName(ingredientId, plain, tx))) return false;
    await recordAIChange(tx, {
      ingredientId,
      sure: true,
      undo: { kind: "plain-name", formerName, name },
    });

    return true;
  });

  if (renamed) await ingredientChanges().changed([ingredientId]);

  return renamed;
}

/** Flag a food AI answered about without changing it, unless the answer was sure or a person decided meanwhile. */
export async function flagByAnswer(ingredientId: string, sure: boolean): Promise<void> {
  const flagged = await withTransaction(async (tx) => {
    if ((await lockIngredients(tx, [ingredientId])) < 1) return false;
    if (!(await isAskableByAI(tx, ingredientId))) return false;
    await refreshAIFlag(tx, ingredientId, { unsure: !sure });

    return true;
  });

  if (flagged) await ingredientChanges().changed([ingredientId]);
}

/** One AI Change as Changed by AI shows it, and whether the viewer may keep or undo it. */
export interface AIChangeItem {
  id: string;
  kind: AIChangeKind;
  sure: boolean;
  kept: boolean;
  createdAt: Date;
  /** The food it is listed under: a merge's is the food the other joined. */
  ingredient: { id: string; name: string; localeNames: LocaleNames };
  /** A parent's parent. */
  target: { id: string; name: string; localeNames: LocaleNames } | null;
  /** The merged food's name, or the name AI replaced. */
  from: string | null;
  fromWords: boolean;
  canAct: boolean;
}

/** Whose food a change was about (a merge's: the food merged away), and what it was before. */
function subjectOf(change: StoredAIChange) {
  const { undo } = change;

  switch (undo.kind) {
    case "merge":
      return { ownerId: undo.ownerId, from: undo.name, fromWords: false };
    case "parent":
      return { ownerId: change.ingredient.ownerId, from: null, fromWords: undo.fromWords === true };
    case "plain-name":
      return { ownerId: change.ingredient.ownerId, from: undo.formerName, fromWords: false };
  }
}

/** Everything Changed by AI lists, each saying whether the viewer may keep or undo it. */
export async function listAIChangesFor(actor: CatalogueActor): Promise<AIChangeItem[]> {
  const [policy, changes] = await Promise.all([getIngredientPermissionPolicy(), listAIChanges()]);
  const names = await findLocaleNames(
    changes.flatMap((change) =>
      change.target ? [change.ingredient.id, change.target.id] : [change.ingredient.id]
    )
  );
  const named = (food: { id: string; name: string }) => ({
    id: food.id,
    name: food.name,
    localeNames: names.get(food.id) ?? {},
  });

  return changes.map((change) => {
    const { ownerId, from, fromWords } = subjectOf(change);

    return {
      id: change.id,
      kind: change.undo.kind,
      sure: change.sure,
      kept: change.kept,
      createdAt: change.createdAt,
      ingredient: named(change.ingredient),
      target: change.target ? named(change.target) : null,
      from,
      fromWords,
      canAct: mayEditIngredientRow(policy.edit, actor, ownerId),
    };
  });
}

/** The change, locked after the tree lock as every catalogue edit takes them, if the actor may act on it. */
async function lockChangeFor(tx: DbTransaction, actor: CatalogueActor, changeId: string) {
  await lockTree(tx);
  const change = await lockAIChange(tx, changeId);

  return await assertMayEdit(actor, change && { ...change, ownerId: subjectOf(change).ownerId });
}

/**
 * Keep an unsure change, lifting the flag it raised. Kept parents and names are the person's
 * decision about the food, so AI asks about it no more.
 */
export async function keepAIChange(
  actor: CatalogueActor,
  changeId: string
): Promise<CatalogueEdit> {
  return await inEdit(async (tx) => {
    const change = await lockChangeFor(tx, actor, changeId);
    const foodId = change.ingredient.id;

    if (change.sure || change.kept) return { changed: [] };
    await settleAIChange(tx, changeId, "kept");
    if (change.undo.kind === "merge") {
      await clearAIFlagUnlessOpen(tx, foodId);
    } else {
      await keepIngredientDistinct(tx, foodId);
      await refreshAIFlag(tx, foodId, { unsure: false });
    }

    return { changed: [foodId] };
  });
}

/** Undo a change as far as the food is still as AI left it, and remember it so AI never repeats it. */
export async function undoAIChange(
  actor: CatalogueActor,
  changeId: string
): Promise<CatalogueEdit> {
  return await inEdit(async (tx) => {
    const change = await lockChangeFor(tx, actor, changeId);
    const foodId = change.ingredient.id;
    const changed = [foodId, ...(await reverseChange(tx, change))];

    await settleAIChange(tx, changeId, "undone");
    // A sure change raised no flag, so undoing it lifts none.
    if (!change.sure) await clearAIFlagUnlessOpen(tx, foodId);

    return { changed };
  });
}

/** Put back what one change took, through `tx`; returns the other foods it touched. */
async function reverseChange(tx: DbTransaction, change: StoredAIChange): Promise<string[]> {
  const foodId = change.ingredient.id;
  const { undo } = change;

  await lockIngredients(tx, [foodId]);

  switch (undo.kind) {
    case "merge": {
      const stillJoined = await aliasesStillOn(tx, foodId, undo.aliasIds);

      if (stillJoined.length === 0) return [];
      const restored = await refusedOn("name-taken", () =>
        insertCatalogueIngredient(tx, { name: undo.name, ownerId: undo.ownerId })
      );

      for (const aliasId of stillJoined) await moveCatalogueAlias(tx, aliasId, restored);
      if (undo.parentId && (await lockIngredients(tx, [undo.parentId])) > 0) {
        await setCatalogueIngredientParent(tx, restored, undo.parentId, { byAI: true });
      }

      return [restored];
    }
    case "parent": {
      const [parent] = (await findIngredientAncestors([foodId], tx)).get(foodId) ?? [];

      // A parent a person set since is theirs to keep.
      if (!change.target || parent !== change.target.id) return [];
      const former = undo.formerParentId;
      const formerFits =
        former !== null &&
        (await lockIngredients(tx, [former])) > 0 &&
        !(await findIngredientAncestors([former], tx)).get(former)?.includes(foodId);

      await setCatalogueIngredientParent(tx, foodId, formerFits ? former : null, { byAI: true });

      return formerFits ? [change.target.id, former] : [change.target.id];
    }
    case "plain-name":
      await restoreName(tx, foodId, undo);

      return [];
  }
}
