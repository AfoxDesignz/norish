// @vitest-environment node
/**
 * Keeping and undoing AI Changes, against a real database: Undo puts back what
 * each kind of change took (a merge's spellings and their lines, a parent, a
 * name) as far as the food is still as AI left it; Keep is the person's own
 * decision about the food. Both follow `edit` on the food the change was
 * about, and a person looking after a food keeps what AI was unsure of.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { withTransaction } from "@norish/db/drizzle";
import {
  listAIChanges,
  sweepAIChanges,
  takeOpenParentChanges,
} from "@norish/db/repositories/ingredient-ai-changes";
import { listUnansweredIngredientIds } from "@norish/db/repositories/ingredient-catalogue";
import { findIngredientAncestors, lockTree } from "@norish/db/repositories/ingredient-relocation";
import { ingredientAIChanges, ingredients } from "@norish/db/schema";
import { isAIEnabled } from "@norish/shared-server/config/server-config-loader";
import {
  keepAIChange,
  listAIChangesFor,
  mergeByAI,
  parentByAI,
  renameByAI,
  undoAIChange,
} from "@norish/shared-server/ingredients/ai-changes";
import {
  deleteIngredient,
  markDistinct,
  mergeIngredients,
} from "@norish/shared-server/ingredients/catalogue";
import { ingredientFor, resolveIngredients } from "@norish/shared-server/ingredients/resolver";

import {
  createTestRecipe,
  createTestUser,
  getRecipeIngredients,
  getTestDb,
  insertTestRecipeLine,
} from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";

vi.mock("@norish/shared-server/config/server-config-loader", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isAIEnabled: vi.fn(),
}));

describe("keeping and undoing AI Changes", () => {
  const testBase = new RepositoryTestBase("test_ingredient_ai_changes");

  let actor: CatalogueActor;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    actor = { userId: user.id, householdUserIds: null, isServerAdmin: false };
    // Every mint here is the words' alone: AI is off, so each is flagged.
    vi.mocked(isAIEnabled).mockResolvedValue(false);
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  async function mint(text: string, userId = actor.userId) {
    const [resolved] = await resolveIngredients([text], { userId });

    return resolved!;
  }

  async function onlyChange() {
    const [change, ...rest] = await listAIChanges();

    expect(rest).toEqual([]);

    return change!;
  }

  function parentOf(ingredientId: string) {
    return findIngredientAncestors([ingredientId]).then(
      (all) => all.get(ingredientId)?.[0] ?? null
    );
  }

  it("undoes a merge: the spellings and their lines are back on a food of their own", async () => {
    const onion = await mint("onion");
    const uien = await mint("uien");
    const recipe = await createTestRecipe(actor.userId);

    await markDistinct(actor, onion.ingredientId);
    await insertTestRecipeLine({ recipeId: recipe.id, name: "uien" }, [uien.aliasId]);

    await expect(mergeByAI(uien.ingredientId, onion.ingredientId, false)).resolves.toBe("applied");
    await expect(ingredientFor(onion.aliasId)).resolves.toMatchObject({ flagged: true });

    await undoAIChange(actor, (await onlyChange()).id);

    const restored = (await ingredientFor(uien.aliasId))!;

    expect(restored).toMatchObject({ name: "uien", flagged: false });
    expect(restored.id).not.toBe(onion.ingredientId);
    await expect(getRecipeIngredients(recipe.id)).resolves.toMatchObject([
      { name: "uien", ingredientId: restored.id },
    ]);
    await expect(ingredientFor(onion.aliasId)).resolves.toMatchObject({
      id: onion.ingredientId,
      flagged: false,
    });
    // Undone, it is no longer listed: it stays only as AI's memory.
    expect(await listAIChanges()).toEqual([]);
  });

  it("undoes a parent: the parent the food had before AI comes back", async () => {
    const vegetable = await mint("vegetable");
    const onion = await mint("onion");
    const red = await mint("red onion");

    // The words filed it under vegetable, as the seed's recheck would; AI moved it.
    await getTestDb()
      .update(ingredients)
      .set({ parentId: vegetable.ingredientId })
      .where(eq(ingredients.id, red.ingredientId));
    await parentByAI(red.ingredientId, onion.ingredientId, false);
    await expect(parentOf(red.ingredientId)).resolves.toBe(onion.ingredientId);

    await undoAIChange(actor, (await onlyChange()).id);

    await expect(parentOf(red.ingredientId)).resolves.toBe(vegetable.ingredientId);
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagged: false });
  });

  it("goes back past every parent AI replaced, to where the food was before AI", async () => {
    const onion = await mint("onion");
    const allium = await mint("allium");
    const red = await mint("red onion");

    await parentByAI(red.ingredientId, allium.ingredientId, false);
    await parentByAI(red.ingredientId, onion.ingredientId, true);
    await undoAIChange(actor, (await onlyChange()).id);

    await expect(parentOf(red.ingredientId)).resolves.toBeNull();
  });

  it("undoes a Plain Name: the former name is back, and stays settled", async () => {
    const tonijn = await mint("GR TONIJN UIT BLIK");

    await expect(
      renameByAI(tonijn.ingredientId, "GR TONIJN UIT BLIK", "tonijn uit blik")
    ).resolves.toBe(true);
    await undoAIChange(actor, (await onlyChange()).id);

    const [row] = await getTestDb()
      .select({ name: ingredients.name, nameSettled: ingredients.nameSettled })
      .from(ingredients)
      .where(eq(ingredients.id, tonijn.ingredientId));

    expect(row).toEqual({ name: "GR TONIJN UIT BLIK", nameSettled: true });
  });

  it("leaves a parent a person set since: Undo only remembers", async () => {
    const onion = await mint("onion");
    const allium = await mint("allium");
    const red = await mint("red onion");

    await parentByAI(red.ingredientId, onion.ingredientId, false);
    const change = await onlyChange();

    await getTestDb()
      .update(ingredients)
      .set({ parentId: allium.ingredientId })
      .where(eq(ingredients.id, red.ingredientId));
    await undoAIChange(actor, change.id);

    await expect(parentOf(red.ingredientId)).resolves.toBe(allium.ingredientId);
    await expect(parentByAI(red.ingredientId, onion.ingredientId, true)).resolves.toBe("undone");
  });

  it("keeps an unsure change: the flag goes once nothing else waits on the food", async () => {
    const onion = await mint("onion");
    const allium = await mint("allium");
    const red = await mint("red onion");
    const uien = await mint("uien");

    await parentByAI(red.ingredientId, allium.ingredientId, false);
    await mergeByAI(uien.ingredientId, onion.ingredientId, false);
    await mergeByAI(red.ingredientId, onion.ingredientId, false);
    const [first, second] = await listAIChanges();

    await keepAIChange(actor, first!.id);
    await expect(ingredientFor(onion.aliasId)).resolves.toMatchObject({ flagged: true });
    await keepAIChange(actor, second!.id);
    await expect(ingredientFor(onion.aliasId)).resolves.toMatchObject({ flagged: false });
    expect((await listAIChanges()).map((change) => change.kept)).toEqual([true, true]);
  });

  it("keeps what AI was unsure of when a person looks after the food themselves", async () => {
    const onion = await mint("onion");
    const red = await mint("red onion");

    await parentByAI(red.ingredientId, onion.ingredientId, false);
    await markDistinct(actor, red.ingredientId);

    expect(await listAIChanges()).toMatchObject([{ kept: true }]);
  });

  it("follows edit on the food the change was about, a merge's included", async () => {
    // Merged into a seeded food, which only an administrator may edit.
    const [seeded] = await getTestDb()
      .insert(ingredients)
      .values({ name: "leek", offId: "en:leek" })
      .returning({ id: ingredients.id });
    const prei = await mint("prei");
    const stranger = await createTestUser();
    const strangers = { userId: stranger.id, householdUserIds: null, isServerAdmin: false };

    await mergeByAI(prei.ingredientId, seeded!.id, false);
    const change = await onlyChange();

    expect(await listAIChangesFor(strangers)).toMatchObject([{ canAct: false }]);
    await expect(undoAIChange(strangers, change.id)).rejects.toMatchObject({
      refusal: "forbidden",
    });
    await expect(keepAIChange(strangers, change.id)).rejects.toMatchObject({
      refusal: "forbidden",
    });
    expect(await listAIChangesFor(actor)).toMatchObject([
      { kind: "merge", from: "prei", ingredient: { name: "leek" }, canAct: true },
    ]);
    await undoAIChange(actor, change.id);
    await expect(ingredientFor(prei.aliasId)).resolves.toMatchObject({ name: "prei" });
  });

  it("refuses a change already undone", async () => {
    const onion = await mint("onion");
    const red = await mint("red onion");

    await parentByAI(red.ingredientId, onion.ingredientId, false);
    const change = await onlyChange();

    await undoAIChange(actor, change.id);
    await expect(undoAIChange(actor, change.id)).rejects.toMatchObject({ refusal: "not-found" });
  });

  it("leaves a flag a sure change never raised when that change is undone", async () => {
    const tonijn = await mint("GR TONIJN UIT BLIK");

    // AI was unsure the food is one of its own, then gave it its Plain Name.
    await getTestDb()
      .update(ingredients)
      .set({ flagged: true, flagReason: "ai-unsure" })
      .where(eq(ingredients.id, tonijn.ingredientId));
    await renameByAI(tonijn.ingredientId, "GR TONIJN UIT BLIK", "tonijn uit blik");
    await undoAIChange(actor, (await onlyChange()).id);

    await expect(ingredientFor(tonijn.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-unsure",
    });
  });

  it("keeps a merge without deciding anything about the food it joined", async () => {
    const onion = await mint("onion");
    const uien = await mint("uien");

    await mergeByAI(uien.ingredientId, onion.ingredientId, false);
    await keepAIChange(actor, (await onlyChange()).id);

    const [row] = await getTestDb()
      .select({ flagged: ingredients.flagged, keptDistinct: ingredients.keptDistinct })
      .from(ingredients)
      .where(eq(ingredients.id, onion.ingredientId));

    expect(row).toEqual({ flagged: false, keptDistinct: false });
  });

  it("follows a parent merged away to the food it joined, and goes with a parent deleted", async () => {
    const onion = await mint("onion");
    const allium = await mint("allium");
    const red = await mint("red onion");
    const admin = { ...actor, isServerAdmin: true };

    await parentByAI(red.ingredientId, onion.ingredientId, false);
    await mergeIngredients(admin, onion.ingredientId, allium.ingredientId);
    expect(await listAIChangesFor(actor)).toMatchObject([{ target: { name: "allium" } }]);

    await deleteIngredient(admin, allium.ingredientId);
    expect(await listAIChanges()).toEqual([]);
  });

  it("lets a Keep or an Undo wait for an answer about the same food rather than deadlock", async () => {
    const onion = await mint("onion");
    const red = await mint("red onion");

    await parentByAI(red.ingredientId, onion.ingredientId, false);
    const change = await onlyChange();
    // Two idle connections, so the two transactions below really run at once.
    const warm = () => withTransaction((tx) => tx.execute(sql`select 1`));

    await Promise.all([warm(), warm()]);

    let undoing: Promise<unknown> = Promise.resolve();
    // A newer answer about the food holds the tree, then replaces its open parent change.
    const answer = withTransaction(async (tx) => {
      await lockTree(tx);
      undoing = undoAIChange(actor, change.id).catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await takeOpenParentChanges(tx, red.ingredientId);
    });

    await expect(answer).resolves.toBeUndefined();
    await expect(undoing).resolves.toMatchObject({ refusal: "not-found" });
  });

  it("sweeps the handled changes older than a month, keeping the undone and the open ones", async () => {
    const onion = await mint("onion");
    const uien = await mint("uien");
    const red = await mint("red onion");
    const leek = await mint("leek");
    const tonijn = await mint("Lekkerste Tonijn");
    const shallot = await mint("shallot");

    await mergeByAI(uien.ingredientId, onion.ingredientId, true);
    await parentByAI(red.ingredientId, onion.ingredientId, false);
    await parentByAI(leek.ingredientId, onion.ingredientId, false);
    await keepAIChange(
      actor,
      (await listAIChangesFor(actor)).find((it) => it.ingredient.id === leek.ingredientId)!.id
    );
    await renameByAI(tonijn.ingredientId, "Lekkerste Tonijn", "tonijn");
    await undoAIChange(
      actor,
      (await listAIChangesFor(actor)).find((it) => it.kind === "plain-name")!.id
    );
    // A month and a day ago, all but the newest.
    await getTestDb()
      .update(ingredientAIChanges)
      .set({ createdAt: sql`now() - interval '31 days'` });
    await renameByAI(shallot.ingredientId, "shallot", "sjalot");

    await expect(sweepAIChanges()).resolves.toBe(2);

    const left = await getTestDb()
      .select({ ingredientId: ingredientAIChanges.ingredientId, kind: ingredientAIChanges.kind })
      .from(ingredientAIChanges);

    // The open parent, the undone name AI remembers, and this month's name.
    expect(left).toEqual(
      expect.arrayContaining([
        { ingredientId: red.ingredientId, kind: "parent" },
        { ingredientId: tonijn.ingredientId, kind: "plain-name" },
        { ingredientId: shallot.ingredientId, kind: "plain-name" },
      ])
    );
    expect(left).toHaveLength(3);
  });

  it("lists for the nightly pass the foods no AI could answer for, that AI may still ask about", async () => {
    const away = await mint("uien");
    const refused = await mint("knaks");
    const unsure = await mint("tonijn");
    const kept = await mint("prei");
    const flag = (id: string, flagReason: string) =>
      getTestDb().update(ingredients).set({ flagReason }).where(eq(ingredients.id, id));

    await flag(away.ingredientId, "ai-unavailable");
    await flag(refused.ingredientId, "ai-key-rejected");
    await flag(unsure.ingredientId, "ai-unsure");
    await flag(kept.ingredientId, "ai-unavailable");
    await markDistinct(actor, kept.ingredientId);

    expect((await listUnansweredIngredientIds()).sort()).toEqual(
      [away.ingredientId, refused.ingredientId].sort()
    );
  });
});
