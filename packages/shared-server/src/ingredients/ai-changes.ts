/**
 * AI Changes (CONTEXT.md; ADR-0037): AI's answers made and recorded in one transaction, kept or
 * undone under `edit` on their food, or on the recipe a Junk Line left.
 */
import type { DbTransaction } from "@norish/db/drizzle";
import type { StoredAIChange } from "@norish/db/repositories/ingredient-ai-changes";
import type { SplitPart } from "@norish/db/repositories/ingredient-relocation";
import type { AIChangeKind, FlagReason } from "@norish/shared/contracts/ingredient-catalogue";
import type { LocaleNames } from "@norish/shared/lib/ingredient-names";
import type { LineJoin } from "@norish/shared/lib/line-foods";
import { withTransaction } from "@norish/db/drizzle";
import {
  aliasesStillOn,
  clearAIFlagUnlessOpen,
  deleteJunkLines,
  findFoldsKeptAsNotJunk,
  flagUnderOpenChange,
  isInAnyPantry,
  listAIChanges,
  lockAIChange,
  readDeletedFood,
  readMergeUndo,
  recordAIChange,
  refreshAIFlag,
  restoreDeletedFood,
  restoreDeletedLine,
  restoreName,
  settleAIChange,
  takeOpenParentChanges,
  wasDeletionUndone,
  wasMergeUndone,
  wasParentUndone,
} from "@norish/db/repositories/ingredient-ai-changes";
import { findLocaleNames } from "@norish/db/repositories/ingredient-aliases";
import {
  deleteCatalogueIngredient,
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
  splitCatalogueIngredient,
} from "@norish/db/repositories/ingredient-relocation";
import {
  getIngredientPermissionPolicy,
  getRecipePermissionPolicy,
} from "@norish/shared-server/config/server-config-loader";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import type { NoFoodAnswer } from "../ai/resolution/ingredient-resolution";
import type { CatalogueActor, CatalogueEdit } from "./catalogue";
import { CatalogueEditError, inEdit, mayEditOwnedRow, refusedOn } from "./catalogue";
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

/**
 * Split a food into the foods its parts resolved to, and delete it. Not an AI Change: a grocery
 * split in two has no Undo.
 */
export async function splitByAI(
  ingredientId: string,
  parts: readonly [SplitPart, ...SplitPart[]],
  joined: LineJoin
) {
  const ids = [ingredientId, ...parts.map((part) => part.ingredientId)];
  const outcome = await withTransaction(async (tx): Promise<ApplyOutcome> => {
    await lockTree(tx);
    if ((await lockIngredients(tx, ids)) < new Set(ids).size) return "gone";
    if (!(await isAskableByAI(tx, ingredientId))) return "decided";
    await splitCatalogueIngredient(tx, ingredientId, parts, joined);

    return "applied";
  });

  return await announceIfApplied(outcome, ids);
}

/**
 * Delete a food AI is sure names no food, with its Junk Lines for nothing; a Pantry Ingredient
 * naming it keeps it, flagged, as does a person's Undo of the same deletion.
 */
export async function deleteByAI(
  ingredientId: string,
  verdict: NoFoodAnswer
): Promise<{ outcome: ApplyOutcome | "kept"; lines: number }> {
  let lines: string[] = [];
  const outcome = await withTransaction(async (tx): Promise<ApplyOutcome | "kept"> => {
    await lockTree(tx);
    if ((await lockIngredients(tx, [ingredientId])) < 1) return "gone";
    const food = await readDeletedFood(tx, ingredientId);

    if (!food) return "gone";
    if (!(await isAskableByAI(tx, ingredientId))) return "decided";
    if (await wasDeletionUndone(tx, ingredientId)) return "undone";
    if (verdict === "nothing") {
      const folds = food.aliases.map((spelling) => spelling.fold);

      if ((await findFoldsKeptAsNotJunk(folds, tx)).size > 0) return "undone";
    }
    if (await isInAnyPantry(tx, ingredientId)) {
      await refreshAIFlag(tx, ingredientId, { unsure: true, reason: "ai-junk" });

      return "kept";
    }
    if (verdict === "nothing") lines = await deleteJunkLines(tx, ingredientId);

    const left = {
      ...food,
      lineFoods: food.lineFoods.filter((row) => !lines.includes(row.lineId)),
    };
    const named = left.lineFoods.length + left.groceries.length + left.recurring.length > 0;

    // Recorded for its Undo, where anything but a Junk Line still named it.
    if (verdict === "tool" || named) {
      await recordAIChange(tx, {
        sure: true,
        undo: { kind: verdict === "tool" ? "tool" : "not-a-food", food: left },
      });
    }
    await deleteCatalogueIngredient(tx, ingredientId);

    return "applied";
  });

  if (outcome === "applied" || outcome === "kept") {
    await ingredientChanges().changed([ingredientId]);
  }

  return { outcome, lines: lines.length };
}

/** Flag a food AI answered about without changing it, unless the answer was sure or a person decided meanwhile. */
export async function flagByAnswer(
  ingredientId: string,
  sure: boolean,
  reason: FlagReason = "ai-unsure"
): Promise<void> {
  const flagged = await withTransaction(async (tx) => {
    if ((await lockIngredients(tx, [ingredientId])) < 1) return false;
    if (!(await isAskableByAI(tx, ingredientId))) return false;
    await refreshAIFlag(tx, ingredientId, { unsure: !sure, reason });

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
  /** The food it is listed under: a merge's is the food the other joined; none for a deleted one. */
  ingredient: { id: string; name: string; localeNames: LocaleNames } | null;
  /** A parent's parent. */
  target: { id: string; name: string; localeNames: LocaleNames } | null;
  /** The recipe a Junk Line was deleted from. */
  recipe: { id: string; name: string } | null;
  /** The merged or deleted food's name, the name AI replaced, or the deleted line. */
  from: string | null;
  fromWords: boolean;
  canAct: boolean;
}

/**
 * Who answers for a change: a food's owner under the ingredient policy (a merge's: the food merged
 * away), or a Junk Line's recipe owner under the recipe policy; and what it was before.
 */
function subjectOf(change: StoredAIChange) {
  const { undo } = change;
  const food = { of: "food" as const, ownerId: change.ingredient?.ownerId ?? null };

  switch (undo.kind) {
    case "merge":
      return { of: "food" as const, ownerId: undo.ownerId, from: undo.name, fromWords: false };
    case "parent":
      return { ...food, from: null, fromWords: undo.fromWords === true };
    case "plain-name":
      return { ...food, from: undo.formerName, fromWords: false };
    case "tool":
    case "not-a-food":
      return {
        of: "food" as const,
        ownerId: undo.food.ownerId,
        from: undo.food.name,
        fromWords: false,
      };
    case "junk-line":
      return {
        of: "recipe" as const,
        ownerId: change.recipe?.ownerId ?? null,
        from: undo.line.name,
        fromWords: false,
      };
  }
}

/** The levels a change follows: the ingredient policy's for a food, the recipe policy's for a line. */
async function editLevels() {
  const [food, recipe] = await Promise.all([
    getIngredientPermissionPolicy(),
    getRecipePermissionPolicy(),
  ]);

  return { food: food.edit, recipe: recipe.edit, recipeView: recipe.view };
}

/** Whether `actor` may act on a change, by its subject's policy; an orphaned recipe is anyone's. */
function mayActOn(
  levels: Awaited<ReturnType<typeof editLevels>>,
  actor: CatalogueActor,
  change: StoredAIChange
): boolean {
  const { of, ownerId } = subjectOf(change);

  if (of === "food") return mayEditOwnedRow(levels.food, actor, ownerId);

  return ownerId === null || mayEditOwnedRow(levels.recipe, actor, ownerId);
}

/** Everything Changed by AI lists that the viewer may see, each saying whether they may act on it. */
export async function listAIChangesFor(actor: CatalogueActor): Promise<AIChangeItem[]> {
  const [levels, all] = await Promise.all([editLevels(), listAIChanges()]);
  // A Junk Line names its recipe, which only those who may see the recipe are shown.
  const changes = all.filter(
    (change) =>
      !change.recipe ||
      change.recipe.ownerId === null ||
      mayEditOwnedRow(levels.recipeView, actor, change.recipe.ownerId)
  );
  const names = await findLocaleNames(
    changes.flatMap((change) =>
      [change.ingredient?.id, change.target?.id].filter((id) => id !== undefined)
    )
  );
  const named = (food: { id: string; name: string }) => ({
    id: food.id,
    name: food.name,
    localeNames: names.get(food.id) ?? {},
  });

  return changes.map((change) => {
    const { from, fromWords } = subjectOf(change);

    return {
      id: change.id,
      kind: change.undo.kind,
      sure: change.sure,
      kept: change.kept,
      createdAt: change.createdAt,
      ingredient: change.ingredient ? named(change.ingredient) : null,
      target: change.target ? named(change.target) : null,
      recipe: change.recipe ? { id: change.recipe.id, name: change.recipe.name } : null,
      from,
      fromWords,
      canAct: mayActOn(levels, actor, change),
    };
  });
}

/** The change, locked after the tree lock as every catalogue edit takes them, if the actor may act on it. */
async function lockChangeFor(tx: DbTransaction, actor: CatalogueActor, changeId: string) {
  await lockTree(tx);
  const change = await lockAIChange(tx, changeId);

  if (!change) throw new CatalogueEditError("not-found");
  if (!mayActOn(await editLevels(), actor, change)) throw new CatalogueEditError("forbidden");

  return change;
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
    const foodId = change.ingredient?.id;

    if (change.sure || change.kept || !foodId) return { changed: [] };
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
    const foodId = change.ingredient?.id;
    const changed = await reverseChange(tx, change);

    await settleAIChange(tx, changeId, "undone");
    // A sure change raised no flag, so undoing it lifts none.
    if (!change.sure && foodId) await clearAIFlagUnlessOpen(tx, foodId);

    return { changed: foodId ? [foodId, ...changed] : changed };
  });
}

/** Put back what one change took, through `tx`; returns the other foods it touched. */
async function reverseChange(tx: DbTransaction, change: StoredAIChange): Promise<string[]> {
  const { undo } = change;

  if (undo.kind === "junk-line") {
    if (change.recipe) await restoreDeletedLine(tx, change.recipe.id, undo.line);

    return [];
  }
  if (undo.kind === "tool" || undo.kind === "not-a-food") {
    const restored = await refusedOn("name-taken", () => restoreDeletedFood(tx, undo.food));

    if (!restored) throw new CatalogueEditError("spelling-taken");

    return [undo.food.ingredientId];
  }

  const foodId = change.ingredient?.id;

  if (!foodId) return [];
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
