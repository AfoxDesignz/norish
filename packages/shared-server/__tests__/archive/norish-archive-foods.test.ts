// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getRecipeFull } from "@norish/db";

import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";
import { writeArchive } from "./norish-fixtures";

vi.mock("@norish/shared-server/media/storage", () => ({
  saveImageBytes: vi.fn(),
  saveStepImageBytes: vi.fn(),
  saveVideoBytes: vi.fn(),
}));

const { extractNorishRecipes, parseNorishRecipeToDTO } =
  await import("@norish/shared-server/archive/norish-parser");
const { createResolvedRecipe } = await import("@norish/shared-server/ingredients/recipe-lines");

/** A recipe exported from the database and imported back: its lines name the same foods. */
describe("a Recipe Archive round trip", () => {
  const testBase = new RepositoryTestBase("test_norish_archive_foods");

  let userId: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  it("keeps every line's food", async () => {
    const sourceId = crypto.randomUUID();
    const texts = ["2 onions, diced", "boter", "# Saus", "100 g parmezaan, geraspt"];

    await createResolvedRecipe(
      sourceId,
      userId,
      {
        name: "Pasta",
        systemUsed: "metric",
        recipeIngredients: texts.map((ingredientName, order) => ({
          ingredientId: null,
          ingredientName,
          amount: null,
          unit: null,
          order,
        })),
        steps: [],
        tags: [],
        cuisines: [],
      },
      { userId }
    );

    const source = (await getRecipeFull(sourceId))!;
    const archive = await writeArchive({
      records: [{ recipe: source, media: [] }],
      exporter: { name: "Mika", origin: "https://norish.example.com" },
      exportedAt: new Date("2026-10-18T12:00:00Z"),
    });
    const [entry] = await extractNorishRecipes(archive);
    const importedId = crypto.randomUUID();
    const { dto } = await parseNorishRecipeToDTO(
      entry!.json,
      importedId,
      new Map(),
      archive.folder(entry!.folderKey)
    );

    await createResolvedRecipe(importedId, userId, dto, { userId });

    const foods = (id: string) =>
      getRecipeFull(id).then((recipe) =>
        recipe!.recipeIngredients.map((line) => [line.ingredientName, line.ingredientId])
      );
    const before = await foods(sourceId);

    expect(before.filter(([, food]) => food !== null)).toHaveLength(3);
    await expect(foods(importedId)).resolves.toEqual(before);
  });
});
