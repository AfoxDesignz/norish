// @vitest-environment node
/**
 * The cleanup the first start of the release runs, against a real database, on a scenario
 * modelled on the production data: seeded stray marks, "gyoza vellen )" and "gyoza vellen
 * ((ontdooid))", "zout en peper" kept distinct, and an undecided own food for the AI pass. It runs
 * once.
 */
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerConfigKeys } from "@norish/config/zod/server-config";
import { mintIngredientWithAliases } from "@norish/db/repositories/ingredient-aliases";
import {
  applyIngredientSeed,
  listSeededIngredientIds,
} from "@norish/db/repositories/ingredient-seed";
import {
  groceries,
  ingredientAliases,
  ingredients,
  pantryIngredients,
  recipeIngredientFoods,
  recurringGroceries,
  serverConfig,
} from "@norish/db/schema";
import { markDistinct } from "@norish/shared-server/ingredients/catalogue";
import { cleanUpCatalogueOnFirstStart } from "@norish/shared-server/ingredients/seed/first-start-cleanup";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import {
  createTestRecipe,
  getSpellingTexts,
  getTestDb,
  insertTestRecipeLine,
} from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";
import { seedEntry } from "../helpers/seed-entries";

describe("the first-start cleanup", () => {
  const testBase = new RepositoryTestBase("test_first_start_cleanup");

  let userId: string;
  let seeded: Map<string, string>;
  const askAI = vi.fn(async (_ids: string[]) => {});

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;
    askAI.mockClear();
    await getTestDb()
      .delete(serverConfig)
      .where(eq(serverConfig.key, ServerConfigKeys.INGREDIENT_SEED_STATE));
    await applyIngredientSeed([
      seedEntry("en:honey", "honey", "3wu)"),
      seedEntry("en:bell-pepper", "bell pepper", "paprika (vrucht)"),
      seedEntry("en:salt", "salt", "zout", "Salz"),
      seedEntry("en:pepper", "pepper", "peper", "Pfeffer"),
    ]);
    seeded = await listSeededIngredientIds();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  /** An own food as earlier versions minted it: its name and every text as written a spelling. */
  async function oldMint(name: string, texts: string[]) {
    const rows = await mintIngredientWithAliases({
      name,
      aliases: texts.map((text) => ({ text, fold: ingredientAliasFold(text) })),
      ownerId: userId,
      locale: null,
      flagged: true,
      flagReason: "upgrade",
    });

    return { ingredientId: rows[0]!.ingredientId, aliasIds: rows.map((row) => row.aliasId) };
  }

  /** The spellings a line names, in order. */
  async function lineSpellings(lineId: string) {
    const rows = await getTestDb()
      .select({ text: ingredientAliases.text })
      .from(recipeIngredientFoods)
      .innerJoin(
        ingredientAliases,
        eq(ingredientAliases.id, recipeIngredientFoods.ingredientAliasId)
      )
      .where(eq(recipeIngredientFoods.recipeIngredientId, lineId))
      .orderBy(asc(recipeIngredientFoods.position));

    return rows.map((row) => row.text);
  }

  async function exists(ingredientId: string) {
    const rows = await getTestDb()
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.id, ingredientId));

    return rows.length > 0;
  }

  it("cleans the catalogue earlier versions left, step by step", async () => {
    const db = getTestDb();
    const recipe = await createTestRecipe(userId);
    const gyoza = await oldMint("gyoza vellen ((ontdooid))", [
      "gyoza vellen ((ontdooid))",
      "gyoza vellen )",
    ]);
    const gyozaLine = await insertTestRecipeLine(
      { recipeId: recipe.id, name: "gyoza vellen ((ontdooid))", amount: "12", order: "0" },
      [gyoza.aliasIds[0]!]
    );

    await db.insert(groceries).values({
      userId,
      name: "gyoza vellen ((ontdooid))",
      ingredientAliasId: gyoza.aliasIds[0]!,
      ingredientId: gyoza.ingredientId,
    });

    const joined = await oldMint("zout en peper", ["zout en peper"]);
    const joinedPointers = {
      ingredientAliasId: joined.aliasIds[0]!,
      ingredientId: joined.ingredientId,
    };

    await markDistinct(
      { userId, householdUserIds: null, isServerAdmin: false },
      joined.ingredientId
    );
    const joinedLine = await insertTestRecipeLine(
      { recipeId: recipe.id, name: "zout en peper", order: "1" },
      [joined.aliasIds[0]!]
    );

    await db.insert(pantryIngredients).values({ userId, ...joinedPointers });
    await db.insert(recurringGroceries).values({
      userId,
      name: "zout en peper",
      ...joinedPointers,
      recurrenceRule: "week",
      nextPlannedFor: "2027-01-01",
    });

    const undecided = await oldMint("kokosbloesemsuiker", ["kokosbloesemsuiker"]);
    const decided = await oldMint("palmsuiker", ["palmsuiker"]);

    await markDistinct(
      { userId, householdUserIds: null, isServerAdmin: false },
      decided.ingredientId
    );

    await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toEqual({
      seeded: 1,
      cleaned: 1,
      removed: 1,
      split: 1,
      renamed: 1,
      asked: 2,
    });

    // 1. Seeded stray marks go; balanced brackets stay.
    expect((await getSpellingTexts(seeded.get("en:honey")!)).sort()).toEqual(["3wu", "honey"]);
    expect((await getSpellingTexts(seeded.get("en:bell-pepper")!)).sort()).toEqual([
      "bell pepper",
      "paprika (vrucht)",
    ]);

    // 2 and 3. One spelling, on the same food, named for it; its line and grocery point at it.
    expect(await getSpellingTexts(gyoza.ingredientId)).toEqual(["gyoza vellen"]);
    await expect(
      db
        .select({ name: ingredients.name })
        .from(ingredients)
        .where(eq(ingredients.id, gyoza.ingredientId))
    ).resolves.toEqual([{ name: "gyoza vellen" }]);
    expect(await lineSpellings(gyozaLine.id)).toEqual(["gyoza vellen"]);
    await expect(
      db
        .select({ alias: groceries.ingredientAliasId, food: groceries.ingredientId })
        .from(groceries)
    ).resolves.toEqual([{ alias: gyoza.aliasIds[1], food: gyoza.ingredientId }]);
    const gyozaFoods = (await db.select({ name: ingredients.name }).from(ingredients)).filter(
      (row) => row.name.includes("gyoza")
    );

    expect(gyozaFoods).toHaveLength(1);

    // 4. The joined food is split and removed, though a person kept it distinct.
    expect(await exists(joined.ingredientId)).toBe(false);
    expect(await lineSpellings(joinedLine.id)).toEqual(["zout", "peper"]);
    await expect(
      db.select({ food: pantryIngredients.ingredientId }).from(pantryIngredients)
    ).resolves.toEqual(
      expect.arrayContaining([{ food: seeded.get("en:salt") }, { food: seeded.get("en:pepper") }])
    );
    await expect(
      db
        .select({ name: recurringGroceries.name, food: recurringGroceries.ingredientId })
        .from(recurringGroceries)
        .orderBy(asc(recurringGroceries.name))
    ).resolves.toEqual([
      { name: "peper", food: seeded.get("en:pepper") },
      { name: "zout", food: seeded.get("en:salt") },
    ]);

    // 5. AI is asked about the own foods no person decided about, and nothing else.
    expect(askAI).toHaveBeenCalledTimes(1);
    expect(askAI.mock.calls[0]![0].sort()).toEqual(
      [gyoza.ingredientId, undecided.ingredientId].sort()
    );
  });

  it.each([
    ["kruidenmix", "zout en peper"],
    ["seasoning", "salt and pepper"],
    ["Gewürzmischung", "Salz und Pfeffer"],
  ])(
    "keeps %s, a food a person merged %s into: only a joined name splits",
    async (mix, joinedText) => {
      const food = await oldMint(mix, [mix, joinedText]);
      const recipe = await createTestRecipe(userId);
      const mixLine = await insertTestRecipeLine({ recipeId: recipe.id, name: mix, order: "0" }, [
        food.aliasIds[0]!,
      ]);
      const joinedLine = await insertTestRecipeLine(
        { recipeId: recipe.id, name: joinedText, order: "1" },
        [food.aliasIds[1]!]
      );

      await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toMatchObject({ split: 0 });
      expect(await exists(food.ingredientId)).toBe(true);
      expect(await lineSpellings(mixLine.id)).toEqual([mix]);
      expect(await lineSpellings(joinedLine.id)).toEqual([joinedText]);
    }
  );

  it("runs once: a second start does nothing", async () => {
    await oldMint("baking soda )", ["baking soda )"]);

    await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toMatchObject({ cleaned: 1 });
    await oldMint("cooked pasta of choice )", ["cooked pasta of choice )"]);

    await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toBeNull();
    expect(askAI).toHaveBeenCalledTimes(1);
    const [left] = await getTestDb()
      .select({ text: ingredientAliases.text })
      .from(ingredientAliases)
      .where(eq(ingredientAliases.fold, ingredientAliasFold("cooked pasta of choice )")));

    expect(left).toEqual({ text: "cooked pasta of choice )" });
  });

  it("keeps the name a person gave a food, cleaning only its spelling", async () => {
    const named = await oldMint("Gyoza (ontdooid)", ["Gyoza (ontdooid) )"]);

    await getTestDb()
      .update(ingredients)
      .set({ nameChosen: true })
      .where(eq(ingredients.id, named.ingredientId));

    await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toMatchObject({ renamed: 0 });
    await expect(
      getTestDb()
        .select({ name: ingredients.name })
        .from(ingredients)
        .where(eq(ingredients.id, named.ingredientId))
    ).resolves.toEqual([{ name: "Gyoza (ontdooid)" }]);
  });

  it("joins a food whose one spelling's clean name another food has, and its rows follow", async () => {
    const legacy = await oldMint("zout naar smaak", ["zout naar smaak"]);
    const recipe = await createTestRecipe(userId);
    const line = await insertTestRecipeLine({ recipeId: recipe.id, name: "zout naar smaak" }, [
      legacy.aliasIds[0]!,
    ]);

    await markDistinct(
      { userId, householdUserIds: null, isServerAdmin: false },
      legacy.ingredientId
    );

    await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toMatchObject({ removed: 1 });
    expect(await exists(legacy.ingredientId)).toBe(false);
    expect(await lineSpellings(line.id)).toEqual(["zout"]);
  });

  it("deletes a food whose one spelling names nothing; its grocery keeps its text", async () => {
    const junk = await oldMint(")", [")"]);

    await getTestDb().insert(groceries).values({
      userId,
      name: ")",
      ingredientAliasId: junk.aliasIds[0]!,
      ingredientId: junk.ingredientId,
    });

    await expect(cleanUpCatalogueOnFirstStart(askAI)).resolves.toMatchObject({ removed: 1 });
    expect(await exists(junk.ingredientId)).toBe(false);
    await expect(
      getTestDb().select({ name: groceries.name, food: groceries.ingredientId }).from(groceries)
    ).resolves.toEqual([{ name: ")", food: null }]);
  });
});
