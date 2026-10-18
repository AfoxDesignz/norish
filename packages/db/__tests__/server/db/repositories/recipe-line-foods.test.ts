// @vitest-environment node

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getRecipeFull } from "@norish/db";
import { db } from "@norish/db/drizzle";
import { writeRecipeLineFoodsTx } from "@norish/db/repositories/ingredients";
import * as schema from "@norish/db/schema";

import {
  createTestIngredient,
  createTestRecipe,
  createTestRecipeIngredients,
  createTestUser,
} from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

/** A recipe line's foods: a list in order, of which a reader of "the line's food" reads the first. */
describe("a recipe line's foods", () => {
  const testBase = new RepositoryTestBase("test_recipe_line_foods");

  let recipeId: string;
  let lineId: string;
  let butter: { id: string; aliasId: string };
  let oil: { id: string; aliasId: string };

  async function food(name: string) {
    const ingredient = (await createTestIngredient({ name }))!;
    const [alias] = await db
      .select({ id: schema.ingredientAliases.id })
      .from(schema.ingredientAliases)
      .where(eq(schema.ingredientAliases.ingredientId, ingredient.id));

    return { id: ingredient.id, aliasId: alias!.id };
  }

  const names = (...foods: Array<{ aliasId: string }>) =>
    db.transaction((tx) =>
      writeRecipeLineFoodsTx(tx, [{ id: lineId, aliasIds: foods.map((f) => f.aliasId) }])
    );

  const line = async () => (await getRecipeFull(recipeId))!.recipeIngredients[0]!;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    await testBase.beforeEachTest();
    butter = await food("boter");
    oil = await food("olie");
    recipeId = (await createTestRecipe((await createTestUser())!.id)).id;
    lineId = (await createTestRecipeIngredients(recipeId, butter.id, "metric", {
      name: "boter of olie",
    }))!.id;
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  it("reads the first food in order, as each write lists them", async () => {
    await names(butter, oil);
    expect((await line()).ingredientId).toBe(butter.id);

    await names(oil, butter);
    expect((await line()).ingredientId).toBe(oil.id);
  });

  it("closes up when a food is deleted, and names none once every food is gone", async () => {
    await names(butter, oil);

    await db.delete(schema.ingredients).where(eq(schema.ingredients.id, butter.id));
    expect(await line()).toMatchObject({ ingredientName: "boter of olie", ingredientId: oil.id });

    await db.delete(schema.ingredients).where(eq(schema.ingredients.id, oil.id));
    expect(await line()).toMatchObject({ ingredientName: "boter of olie", ingredientId: null });
  });
});
