// @vitest-environment node
/**
 * AI checks the spellings a person, a merge or an import added to a seeded food (ticket 46),
 * against a real database: once, at the first start with AI on, a request per seeded food listing
 * only those spellings. The language model is mocked at `generateStructured`.
 */
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { ServerConfigKeys } from "@norish/config/zod/server-config";
import { addIngredientAliases } from "@norish/db/repositories/ingredient-aliases";
import { withTransaction } from "@norish/db/drizzle";
import { addToJunkPile, listJunkFolds } from "@norish/db/repositories/ingredient-junk-pile";
import {
  applyIngredientSeed,
  listSeededIngredientIds,
} from "@norish/db/repositories/ingredient-seed";
import {
  groceries,
  ingredientAliases,
  ingredients,
  recipeIngredientFoods,
  serverConfig,
} from "@norish/db/schema";
import { decide, generateStructured } from "@norish/shared-server/ai/runtime/runtime";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { listAIChangesFor, undoAIChange } from "@norish/shared-server/ingredients/ai-changes";
import { onIngredientsMinted } from "@norish/shared-server/ingredients/minted";
import { resolveIngredients } from "@norish/shared-server/ingredients/resolver";
import { readIngredientSeedState } from "@norish/shared-server/ingredients/seed/catalogue-seed";
import {
  checkSpellingsOf,
  checkSpellingsOnFirstStart,
} from "@norish/shared-server/ingredients/spelling-check";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import {
  createTestRecipe,
  getTestDb,
  insertTestRecipeLine,
  mintTestFood,
} from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";
import { seedEntry } from "../helpers/seed-entries";

vi.mock("@norish/shared-server/ai/runtime/runtime", () => ({
  decide: vi.fn(),
  generateStructured: vi.fn(),
}));
vi.mock("@norish/shared-server/config/server-config-loader", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isAIEnabled: vi.fn(),
  isDecisionUseEnabled: vi.fn(),
}));

type Kind = "this-food" | "not-a-food" | "other-food";

/** The language model's answer about the listed spellings, by text; one left out is not answered. */
function answers(verdicts: Record<string, Kind | [Kind, string]>) {
  vi.mocked(generateStructured).mockImplementationOnce((async ({
    sections,
  }: {
    sections: string[];
  }) => {
    const listed = sections.at(-1)!.split("\n").slice(1);

    return {
      spellings: listed.flatMap((entry) => {
        const [number, text] = entry.split(". ");
        const verdict = verdicts[text!];

        if (!verdict) return [];
        const [kind, otherFood = null] = typeof verdict === "string" ? [verdict] : verdict;

        return [{ number: Number(number), kind, otherFood }];
      }),
    };
  }) as never);
}

describe("AI checks the spellings added to a seeded food", () => {
  const testBase = new RepositoryTestBase("test_spelling_check");

  let userId: string;
  let actor: CatalogueActor;
  let seeded: Map<string, string>;
  const minted: string[] = [];

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;
    actor = { userId, householdUserIds: null, isServerAdmin: true };
    minted.length = 0;
    onIngredientsMinted(async (ids) => void minted.push(...ids));
    vi.mocked(generateStructured).mockReset();
    vi.mocked(decide).mockReset();
    vi.mocked(isAIEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
    await getTestDb()
      .delete(serverConfig)
      .where(eq(serverConfig.key, ServerConfigKeys.INGREDIENT_SEED_STATE));
    await applyIngredientSeed([
      seedEntry("en:chicken-breast", "chicken breast", "chicken breasts"),
      seedEntry("en:chicken-thigh", "chicken thigh"),
      seedEntry("en:salt", "salt"),
    ]);
    seeded = await listSeededIngredientIds();
  });

  afterAll(async () => {
    onIngredientsMinted(undefined);
    await testBase.teardown();
  });

  /** Spellings added to a seeded food, as people and imports add them; by text. */
  async function added(offId: string, ...texts: string[]) {
    const rows = await addIngredientAliases({
      ingredientId: seeded.get(offId)!,
      aliases: texts.map((text) => ({ text, fold: ingredientAliasFold(text) })),
      ownerId: userId,
      locale: null,
    });

    return new Map(rows!.map((row) => [row.text, row.aliasId]));
  }

  async function line(name: string, aliasId: string) {
    const recipe = await createTestRecipe(userId);

    return await insertTestRecipeLine({ recipeId: recipe.id, name }, [aliasId]);
  }

  /** The foods a line names, by name, in order. */
  async function lineFoods(lineId: string) {
    const rows = await getTestDb()
      .select({ food: ingredients.name, spelling: ingredientAliases.text })
      .from(recipeIngredientFoods)
      .innerJoin(
        ingredientAliases,
        eq(ingredientAliases.id, recipeIngredientFoods.ingredientAliasId)
      )
      .innerJoin(ingredients, eq(ingredients.id, ingredientAliases.ingredientId))
      .where(eq(recipeIngredientFoods.recipeIngredientId, lineId))
      .orderBy(asc(recipeIngredientFoods.position));

    return rows;
  }

  async function spellingsOf(ingredientId: string) {
    const rows = await getTestDb()
      .select({ text: ingredientAliases.text })
      .from(ingredientAliases)
      .where(eq(ingredientAliases.ingredientId, ingredientId));

    return rows.map((row) => row.text).sort();
  }

  /** The sections the last spelling check sent. */
  function askedSections() {
    const call = vi.mocked(generateStructured).mock.calls.at(-1)![0];

    expect(call.prompt).toBe("ingredient-spelling-check");

    return call.sections;
  }

  it("removes the spellings AI says are not a food, piles them, and reads their lines again", async () => {
    const chicken = seeded.get("en:chicken-breast")!;
    const spelled = await added("en:chicken-breast", "boneless", "lbs boneless", "kipfilet");
    const commaLine = await line("boneless, skinless chicken breasts", spelled.get("boneless")!);
    const bareLine = await line("boneless", spelled.get("boneless")!);
    const lbsLine = await line(
      "lbs boneless, skinless chicken breast (about 1 lb.)",
      spelled.get("lbs boneless")!
    );
    const kipLine = await line("kipfilet", spelled.get("kipfilet")!);

    answers({ boneless: "not-a-food", "lbs boneless": "not-a-food", kipfilet: "this-food" });

    const outcome = await checkSpellingsOf(chicken);

    expect(outcome).toMatchObject({ outcome: "checked", kept: ["kipfilet"], moved: [] });
    expect(outcome.outcome === "checked" && outcome.removed.sort()).toEqual([
      "boneless",
      "lbs boneless",
    ]);
    // Only the spellings the seed did not give, never the seed's own.
    const [name, listed] = askedSections();

    expect(name).toBe("Name: chicken breast");
    expect(
      listed!
        .split("\n")
        .slice(1)
        .map((entry) => entry.replace(/^\d+\. /, ""))
        .sort()
    ).toEqual(["boneless", "kipfilet", "lbs boneless"]);
    expect(await spellingsOf(chicken)).toEqual(["chicken breast", "chicken breasts", "kipfilet"]);
    expect(await listJunkFolds()).toEqual(expect.arrayContaining(["boneless", "lbs boneless"]));
    // The rest of the line names a food; a line that is all junk names none.
    const [commaFood] = await lineFoods(commaLine.id);

    // One mint for both lines, its name from whichever spelling went first; AI's pass follows it.
    expect(commaFood?.food).toMatch(/^skinless chicken breasts?$/);
    expect(await lineFoods(lbsLine.id)).toEqual([commaFood]);
    expect(minted).toContain(
      (
        await getTestDb()
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(eq(ingredients.name, commaFood!.food))
      )[0]!.id
    );
    expect(await lineFoods(bareLine.id)).toEqual([]);
    expect(await lineFoods(kipLine.id)).toEqual([{ food: "chicken breast", spelling: "kipfilet" }]);

    const changes = await listAIChangesFor(actor);

    expect(changes.map((change) => [change.kind, change.ingredient?.name, change.from])).toEqual(
      expect.arrayContaining([
        ["spelling", "chicken breast", "boneless"],
        ["spelling", "chicken breast", "lbs boneless"],
      ])
    );

    // Undo puts the spelling and its lines back, and takes it off the pile.
    await undoAIChange(actor, changes.find((change) => change.from === "boneless")!.id);

    expect(await spellingsOf(chicken)).toContain("boneless");
    expect(await lineFoods(commaLine.id)).toEqual([
      { food: "chicken breast", spelling: "boneless" },
    ]);
    expect(await lineFoods(bareLine.id)).toEqual([
      { food: "chicken breast", spelling: "boneless" },
    ]);
    expect(await listJunkFolds()).not.toContain("boneless");
    expect(await listJunkFolds()).toContain("lbs boneless");

    // An undone removal is never made again.
    answers({ boneless: "not-a-food" });
    await checkSpellingsOf(chicken);
    expect(await spellingsOf(chicken)).toContain("boneless");
  });

  it("takes a fold the seed piled off the pile on Undo, so the next line finds the spelling", async () => {
    const chicken = seeded.get("en:chicken-breast")!;
    const spelled = await added("en:chicken-breast", "boneless");

    await withTransaction((tx) => addToJunkPile(tx, ["boneless"], { reason: "seed" }));
    answers({ boneless: "not-a-food" });
    await checkSpellingsOf(chicken);
    const [change] = await listAIChangesFor(actor);

    await undoAIChange(actor, change!.id);

    expect(await spellingsOf(chicken)).toContain("boneless");
    expect(await listJunkFolds()).not.toContain("boneless");
    const [found] = await resolveIngredients(["boneless"], { userId });

    expect(found?.aliasId).toBe(spelled.get("boneless"));
  });

  it("moves a spelling AI says names another food there, with its rows", async () => {
    const breast = seeded.get("en:chicken-breast")!;
    const thigh = seeded.get("en:chicken-thigh")!;
    const spelled = await added("en:chicken-breast", "kippendijen");
    const dijLine = await line("500 g kippendijen", spelled.get("kippendijen")!);

    await getTestDb()
      .insert(groceries)
      .values({
        userId,
        name: "kippendijen",
        ingredientAliasId: spelled.get("kippendijen")!,
        ingredientId: breast,
      });
    answers({ kippendijen: ["other-food", "chicken thigh"] });

    await expect(checkSpellingsOf(breast)).resolves.toMatchObject({
      outcome: "checked",
      moved: [{ spelling: "kippendijen", to: "chicken thigh" }],
    });
    expect(await spellingsOf(thigh)).toEqual(["chicken thigh", "kippendijen"]);
    expect(await lineFoods(dijLine.id)).toEqual([
      { food: "chicken thigh", spelling: "kippendijen" },
    ]);
    const [grocery] = await getTestDb()
      .select({ ingredientId: groceries.ingredientId })
      .from(groceries);

    expect(grocery?.ingredientId).toBe(thigh);
    expect(await listJunkFolds()).not.toContain("kippendijen");

    const [change] = await listAIChangesFor(actor);

    expect(change).toMatchObject({ kind: "spelling", from: "kippendijen" });
    expect(change?.target?.name).toBe("chicken thigh");
    await undoAIChange(actor, change!.id);
    expect(await spellingsOf(breast)).toContain("kippendijen");
    expect(await lineFoods(dijLine.id)).toEqual([
      { food: "chicken breast", spelling: "kippendijen" },
    ]);
  });

  it("removes a spelling of another food nothing finds, minting where nothing knows its lines", async () => {
    const salt = seeded.get("en:salt")!;
    const spelled = await added("en:salt", "zeezoutvlokken");
    const flakesLine = await line("zeezoutvlokken", spelled.get("zeezoutvlokken")!);

    answers({ zeezoutvlokken: ["other-food", "sea salt flakes"] });

    await expect(checkSpellingsOf(salt)).resolves.toMatchObject({
      removed: ["zeezoutvlokken"],
    });
    expect(await spellingsOf(salt)).toEqual(["salt"]);
    expect(await listJunkFolds()).not.toContain("zeezoutvlokken");
    expect(await lineFoods(flakesLine.id)).toEqual([
      { food: "zeezoutvlokken", spelling: "zeezoutvlokken" },
    ]);
  });

  it("runs once, at the first start with AI on, over seeded foods only", async () => {
    await added("en:chicken-breast", "kipfilet");
    await mintTestFood("hamburgerbroodjes");
    const queue = vi.fn(async (_ids: string[]) => {});

    vi.mocked(isAIEnabled).mockResolvedValue(false);
    await expect(checkSpellingsOnFirstStart(queue)).resolves.toBeNull();
    expect(queue).not.toHaveBeenCalled();
    expect((await readIngredientSeedState()).spellingCheckVersion).toBe(0);

    vi.mocked(isAIEnabled).mockResolvedValue(true);
    await expect(checkSpellingsOnFirstStart(queue)).resolves.toEqual({ queued: 1 });
    expect(queue).toHaveBeenCalledWith([seeded.get("en:chicken-breast")]);
    expect((await readIngredientSeedState()).spellingCheckVersion).toBe(1);

    await expect(checkSpellingsOnFirstStart(queue)).resolves.toBeNull();
    expect(queue).toHaveBeenCalledTimes(1);
  });
});
