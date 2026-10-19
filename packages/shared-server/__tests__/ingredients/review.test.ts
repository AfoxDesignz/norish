// @vitest-environment node
/**
 * Asking AI about an Ingredient after the fact, against a real database: AI's
 * answer is made, sure or not, and recorded as an AI Change; an unsure one
 * flags its food. The food itself is never its own candidate, and a food a
 * person decided about, or a seeded one, is never asked about. The Decision
 * is mocked at `decide` and the language model at `generateStructured`, as in
 * rung 3's tests.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionQuestions } from "@norish/shared-server/ai/runtime/runtime";
import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { listAIChanges } from "@norish/db/repositories/ingredient-ai-changes";
import { findIngredientAncestors } from "@norish/db/repositories/ingredient-relocation";
import {
  groceries,
  ingredients,
  pantryIngredients,
  recipeIngredientFoods,
  recipeIngredients,
  recurringGroceries,
} from "@norish/db/schema";
import { decide, generateStructured } from "@norish/shared-server/ai/runtime/runtime";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { keepAIChange, undoAIChange } from "@norish/shared-server/ingredients/ai-changes";
import {
  markDistinct,
  renameIngredient,
  setParent,
} from "@norish/shared-server/ingredients/catalogue";
import { ingredientFor, resolveIngredients } from "@norish/shared-server/ingredients/resolver";
import { askAIAbout } from "@norish/shared-server/ingredients/review";

import {
  createTestRecipe,
  getTestDb,
  insertTestRecipeLine,
} from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";

vi.mock("@norish/shared-server/ai/runtime/runtime", () => ({
  decide: vi.fn(),
  generateStructured: vi.fn(),
}));
vi.mock("@norish/shared-server/config/server-config-loader", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isAIEnabled: vi.fn(),
  isDecisionUseEnabled: vi.fn(),
}));

/** A Decision that picks the option reading `pick` with probability `p`, and records what it was offered. */
function decides(pick: string, p: number, offered: string[] = []) {
  vi.mocked(decide).mockImplementationOnce((async ({
    questions,
  }: {
    questions: DecisionQuestions;
  }) => {
    const [id, question] = Object.entries(questions)[0]!;

    if (question.type !== "choice") throw new Error("expected a choice");

    const labels = Object.keys(question.criteria);

    offered.push(...labels.map((label) => question.criteria[label]!));

    const choice = labels.find((label) => question.criteria[label] === pick);

    if (!choice) throw new Error(`no option reads "${pick}": ${JSON.stringify(question.criteria)}`);

    const rest = (1 - p) / Math.max(labels.length - 1, 1);

    return {
      model: "jev-test",
      answers: {
        [id]: {
          type: "choice",
          choice,
          probabilities: Object.fromEntries(
            labels.map((label) => [label, label === choice ? p : rest])
          ),
        },
      },
    };
  }) as never);
}

/**
 * What the language model answers, per prompt, in order: reading and comparing
 * a name, and reading its Plain Name. A Plain Name nobody queued is null: AI
 * found no food in the name, so nothing is renamed.
 */
const modelAnswers: Record<string, unknown[]> = {};

function answers(prompt: "ingredient-resolution" | "ingredient-plain-name", answer: unknown) {
  (modelAnswers[prompt] ??= []).push(answer);
}

/** What the language model reads a name as, before any comparing. */
function reads(reading: { englishName: string | null; generalFood: string | null; sure: boolean }) {
  answers("ingredient-resolution", reading);
}

/** The language model's comparison: a verdict on the `food`th candidate. */
function compares(
  verdict: "same" | "kind-of" | "new" | "tool" | "nothing",
  food: number | null,
  sure: boolean
) {
  answers("ingredient-resolution", {
    verdict,
    food,
    sure,
    parts: null,
    joined: null,
    englishName: null,
  });
}

/** The language model's answer that a name is several foods. */
function splits(parts: string[], joined: "together" | "alternatives", sure: boolean) {
  answers("ingredient-resolution", {
    verdict: "several",
    food: null,
    sure,
    parts,
    joined,
    englishName: null,
  });
}

describe("asking AI about an Ingredient", () => {
  const testBase = new RepositoryTestBase("test_ingredient_review");

  let actor: CatalogueActor;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    actor = { userId: user.id, householdUserIds: null, isServerAdmin: false };
    vi.mocked(decide).mockReset();
    for (const prompt of Object.keys(modelAnswers)) delete modelAnswers[prompt];
    vi.mocked(generateStructured)
      .mockReset()
      .mockImplementation((async ({ prompt }: { prompt: string }) => {
        const next = modelAnswers[prompt]?.shift();

        if (next instanceof Error) throw next;
        if (next !== undefined) return next;
        if (prompt === "ingredient-plain-name") return { plainName: null };
        throw new Error(`no ${prompt} answer queued`);
      }) as never);
    vi.mocked(isAIEnabled).mockResolvedValue(true);
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(true);
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  /** A food minted while nothing could be asked: flagged, as the upgrade leaves them. */
  async function flagged(text: string) {
    vi.mocked(isAIEnabled).mockResolvedValueOnce(false);
    const [resolved] = await resolveIngredients([text], { userId: actor.userId });

    return resolved!;
  }

  /** A food someone kept: unflagged, and never asked about itself. */
  async function kept(text: string) {
    const food = await flagged(text);

    await markDistinct(actor, food.ingredientId);

    return food;
  }

  /** What Changed by AI lists, as kind, food, other food, sureness and what it was. */
  async function changes() {
    return (await listAIChanges()).map((change) => ({
      kind: change.undo.kind,
      food: change.ingredient?.name ?? null,
      target: change.target?.name ?? null,
      sure: change.sure,
      kept: change.kept,
    }));
  }

  function parentOf(ingredientId: string) {
    return findIngredientAncestors([ingredientId]).then(
      (all) => all.get(ingredientId)?.[0] ?? null
    );
  }

  it("merges a food AI is sure is a known one, never offering the food itself, and raises no flag", async () => {
    const onion = await kept("onion");
    const bulbs = await flagged("onion bulbs");
    const offered: string[] = [];

    reads({ englishName: "onion", generalFood: null, sure: true });
    decides("Is onion", 0.95, offered);

    await expect(askAIAbout(bulbs.ingredientId)).resolves.toMatchObject({
      outcome: "merge",
      into: "onion",
      sure: true,
      considered: ["onion"],
      englishName: "onion",
    });
    expect(offered).not.toContain("Is onion bulbs");
    await expect(ingredientFor(bulbs.aliasId)).resolves.toMatchObject({
      id: onion.ingredientId,
      flagged: false,
    });
    expect(await changes()).toEqual([
      { kind: "merge", food: "onion", target: null, sure: true, kept: false },
    ]);
  });

  it("merges a food AI is unsure is a known one too, and flags the food it joined", async () => {
    const onion = await kept("onion");
    const rings = await flagged("onion rings");

    reads({ englishName: "onion rings", generalFood: "onion", sure: false });
    decides("Is onion", 0.4);
    compares("same", 1, false);

    await expect(askAIAbout(rings.ingredientId)).resolves.toMatchObject({
      outcome: "merge",
      into: "onion",
      sure: false,
    });
    await expect(ingredientFor(rings.aliasId)).resolves.toMatchObject({
      id: onion.ingredientId,
      flagged: true,
      flagReason: "ai-unsure",
    });
    expect(await changes()).toMatchObject([{ kind: "merge", food: "onion", sure: false }]);
  });

  it("files a food under the parent AI is unsure of, flags it, and lists the change to keep or undo", async () => {
    const onion = await kept("onion");
    const red = await flagged("red onion");

    reads({ englishName: "red onion", generalFood: "onion", sure: false });
    decides("Is a kind of onion", 0.4);
    compares("kind-of", 1, false);

    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "parent",
      of: "onion",
      sure: false,
    });
    await expect(parentOf(red.ingredientId)).resolves.toBe(onion.ingredientId);
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-unsure",
    });
    expect(await changes()).toEqual([
      { kind: "parent", food: "red onion", target: "onion", sure: false, kept: false },
    ]);
  });

  it("files a food under the parent AI is sure of, and clears the flag no AI could answer for", async () => {
    const onion = await kept("onion");
    const red = await flagged("red onion");

    reads({ englishName: "red onion", generalFood: "onion", sure: true });
    decides("Is a kind of onion", 0.95);

    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "parent",
      sure: true,
    });
    await expect(parentOf(red.ingredientId)).resolves.toBe(onion.ingredientId);
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagged: false });
    expect(await changes()).toMatchObject([{ kind: "parent", sure: true }]);
  });

  it("calls a food AI is sure is its own one, clearing its flag, and gives it its Plain Name", async () => {
    await kept("onion");
    const spring = await flagged("Spring Onions Fresh");

    reads({ englishName: "spring onion", generalFood: null, sure: true });
    decides("Is none of these, but a food of its own", 0.95);
    answers("ingredient-plain-name", { plainName: "spring onions" });

    await expect(askAIAbout(spring.ingredientId)).resolves.toMatchObject({
      outcome: "rename",
      to: "spring onions",
    });
    await expect(ingredientFor(spring.aliasId)).resolves.toMatchObject({
      name: "spring onions",
      flagged: false,
    });
    expect(await changes()).toMatchObject([{ kind: "plain-name", food: "spring onions" }]);
  });

  it("leaves a food AI is not sure is its own as it was, flagged as unsure", async () => {
    const thing = await flagged("Multitool deluxe");

    reads({ englishName: "multitool", generalFood: "tool", sure: false });

    await expect(askAIAbout(thing.ingredientId)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "ai-unsure",
      englishName: "multitool",
    });
    await expect(ingredientFor(thing.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-unsure",
    });
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    expect(await changes()).toEqual([]);
  });

  it("leaves the food and its changes as they were when no answer comes, the flag saying why", async () => {
    await kept("onion");
    const red = await flagged("red onion");

    reads({ englishName: "red onion", generalFood: "onion", sure: false });
    decides("Is a kind of onion", 0.4);
    compares("kind-of", 1, false);
    await askAIAbout(red.ingredientId);
    vi.mocked(decide).mockRejectedValue(new Error("Decision Model unreachable"));
    answers("ingredient-resolution", new Error("model unreachable"));
    answers("ingredient-resolution", new Error("model unreachable"));

    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "ai-unavailable",
    });
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({
      flagReason: "ai-unavailable",
    });
    expect(await changes()).toMatchObject([{ kind: "parent", sure: false }]);
  });

  it("keeps the flag a food has when AI is switched off while the pass waits", async () => {
    const red = await flagged("red onion");

    await getTestDb()
      .update(ingredients)
      .set({ flagReason: "ai-unavailable" })
      .where(eq(ingredients.id, red.ingredientId));
    vi.mocked(isAIEnabled).mockResolvedValue(false);

    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "ai-off",
    });
    // Still one the nightly pass asks again once AI is back.
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({
      flagReason: "ai-unavailable",
    });
  });

  it("asks AI about a name no known food shares a word with, and follows the food it names", async () => {
    // "ui" shares no letters with "onion": rung 3 asked nothing and minted it flagged.
    const onion = await kept("onion");
    const ui = await flagged("ui");

    reads({ englishName: "onion", generalFood: null, sure: true });
    decides("Is onion", 0.95);

    await expect(askAIAbout(ui.ingredientId)).resolves.toMatchObject({
      outcome: "merge",
      into: "onion",
    });
    await expect(ingredientFor(ui.aliasId)).resolves.toMatchObject({ id: onion.ingredientId });
  });

  it("files a food under the general food its reading names, or a candidate's parent", async () => {
    const chicken = await kept("chicken");
    const kipfilet = await flagged("kipfilet");

    reads({ englishName: "chicken breast", generalFood: "chicken", sure: true });
    decides("Is a kind of chicken", 0.9);
    await expect(askAIAbout(kipfilet.ingredientId)).resolves.toMatchObject({
      outcome: "parent",
      of: "chicken",
    });
    await expect(parentOf(kipfilet.ingredientId)).resolves.toBe(chicken.ingredientId);

    const sausage = await kept("sausage");
    const frankfurter = await kept("frankfurter");

    await setParent(actor, frankfurter.ingredientId, sausage.ingredientId);
    const knaks = await flagged("knakworst");
    const offered: string[] = [];

    reads({ englishName: "frankfurter", generalFood: null, sure: true });
    decides("Is a kind of sausage", 0.9, offered);
    await expect(askAIAbout(knaks.ingredientId)).resolves.toMatchObject({
      outcome: "parent",
      of: "sausage",
      considered: expect.arrayContaining(["frankfurter", "sausage"]),
    });
    expect(offered).toContain("Is a kind of sausage");
  });

  it("asks nothing about a food a person kept distinct, named or parented, nor a seeded one", async () => {
    const onion = await kept("onion");
    const named = await flagged("sjalot");
    const parented = await flagged("red onion");
    const [seeded] = await getTestDb()
      .insert(ingredients)
      .values({ name: "leek", offId: "en:leek", flagged: true })
      .returning({ id: ingredients.id });

    await renameIngredient(actor, named.ingredientId, "sjalotten");
    await setParent(actor, parented.ingredientId, onion.ingredientId);

    for (const id of [onion.ingredientId, named.ingredientId, parented.ingredientId, seeded!.id]) {
      await expect(askAIAbout(id)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "decided",
      });
    }
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
  });

  it("never makes a merge or a parent a person undid again", async () => {
    const onion = await kept("onion");
    const bulbs = await flagged("onion bulbs");
    const red = await flagged("red onion");

    reads({ englishName: "onion", generalFood: null, sure: true });
    decides("Is onion", 0.95);
    await askAIAbout(bulbs.ingredientId);
    reads({ englishName: "red onion", generalFood: "onion", sure: true });
    decides("Is a kind of onion", 0.95);
    await askAIAbout(red.ingredientId);
    for (const change of await listAIChanges()) await undoAIChange(actor, change.id);

    const restored = (await ingredientFor(bulbs.aliasId))!;

    reads({ englishName: "onion", generalFood: null, sure: true });
    decides("Is onion", 0.95);
    await expect(askAIAbout(restored.id)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "undone",
    });
    reads({ englishName: "red onion", generalFood: "onion", sure: true });
    decides("Is a kind of onion", 0.95);
    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "undone",
    });
    await expect(ingredientFor(bulbs.aliasId)).resolves.not.toMatchObject({
      id: onion.ingredientId,
    });
    await expect(parentOf(red.ingredientId)).resolves.toBeNull();
    expect(await changes()).toEqual([]);
  });

  it("asks a food kept from an unsure change no more", async () => {
    await kept("onion");
    const red = await flagged("red onion");

    reads({ englishName: "red onion", generalFood: "onion", sure: false });
    decides("Is a kind of onion", 0.4);
    compares("kind-of", 1, false);
    await askAIAbout(red.ingredientId);
    await keepAIChange(actor, (await listAIChanges())[0]!.id);

    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagged: false });
    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "decided",
    });
    expect(await changes()).toMatchObject([{ kind: "parent", kept: true }]);
  });

  it("passes over a food that is gone", async () => {
    const onion = await flagged("onion");

    await getTestDb().delete(ingredients).where(eq(ingredients.id, onion.ingredientId));

    await expect(askAIAbout(onion.ingredientId)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "not-found",
    });
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
  });

  describe("several foods, a tool and nothing", () => {
    /** A recipe line, a Grocery and a recurring grocery naming `food` as `text`, and a Pantry Ingredient if `pantry`. */
    async function nameEverywhere(
      food: { aliasId: string; ingredientId: string },
      text: string,
      { pantry = true }: { pantry?: boolean } = {}
    ) {
      const db = getTestDb();
      const recipe = await createTestRecipe(actor.userId);
      const pointers = { ingredientAliasId: food.aliasId, ingredientId: food.ingredientId };
      const line = await insertTestRecipeLine({ recipeId: recipe.id, name: text }, [food.aliasId]);

      await db.insert(groceries).values({ userId: actor.userId, name: text, ...pointers });
      await db.insert(recurringGroceries).values({
        userId: actor.userId,
        name: text,
        ...pointers,
        recurrenceRule: "week",
        nextPlannedFor: "2027-01-01",
      });
      if (pantry) await db.insert(pantryIngredients).values({ userId: actor.userId, ...pointers });

      return { recipe: recipe.id, line: line.id };
    }

    /** What a line names, in order, and how. */
    async function lineFoods(lineId: string) {
      const db = getTestDb();
      const [line] = await db
        .select({ joined: recipeIngredients.joined })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.id, lineId));
      const foods = await db
        .select({ aliasId: recipeIngredientFoods.ingredientAliasId })
        .from(recipeIngredientFoods)
        .where(eq(recipeIngredientFoods.recipeIngredientId, lineId))
        .orderBy(asc(recipeIngredientFoods.position));

      return { joined: line?.joined, aliasIds: foods.map((food) => food.aliasId) };
    }

    /** The name and alias of every row of `table`, by name. */
    async function rowsOf(table: typeof groceries | typeof recurringGroceries) {
      return await getTestDb()
        .select({ name: table.name, aliasId: table.ingredientAliasId })
        .from(table)
        .orderBy(asc(table.name));
    }

    async function pantryAliases() {
      const rows = await getTestDb()
        .select({ aliasId: pantryIngredients.ingredientAliasId })
        .from(pantryIngredients);

      return rows.map((row) => row.aliasId).sort();
    }

    async function exists(ingredientId: string) {
      const rows = await getTestDb()
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(eq(ingredients.id, ingredientId));

      return rows.length > 0;
    }

    it("splits a food AI is sure names several, everything naming it naming each instead, and removes it", async () => {
      // Minted before either part was known, so its words could not split it.
      const joined = await flagged("ketchup and mustard");
      const ketchup = await kept("ketchup");
      const mustard = await kept("mustard");
      const named = await nameEverywhere(joined, "ketchup and mustard");

      reads({ englishName: null, generalFood: null, sure: true });
      decides("Names several foods at once, joined by and or or", 0.95);
      splits(["ketchup", "mustard"], "together", true);

      await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
        outcome: "split",
        into: ["ketchup", "mustard"],
      });
      expect(await lineFoods(named.line)).toEqual({
        joined: "together",
        aliasIds: [ketchup.aliasId, mustard.aliasId],
      });
      // Together, a grocery is a row per food, each named for its part.
      const each = [
        { name: "ketchup", aliasId: ketchup.aliasId },
        { name: "mustard", aliasId: mustard.aliasId },
      ];

      expect(await rowsOf(groceries)).toEqual(each);
      expect(await rowsOf(recurringGroceries)).toEqual(each);
      expect(await pantryAliases()).toEqual([ketchup.aliasId, mustard.aliasId].sort());
      expect(await exists(joined.ingredientId)).toBe(false);
      // Not listed: a split grocery cannot be put back together.
      expect(await changes()).toEqual([]);
    });

    it("puts the first of a split's alternatives on the list, and keeps each in the Pantry", async () => {
      const joined = await flagged("Dijon or yellow mustard");
      const dijon = await kept("Dijon mustard");
      const yellow = await kept("yellow mustard");
      const named = await nameEverywhere(joined, "Dijon or yellow mustard");

      reads({ englishName: null, generalFood: null, sure: true });
      decides("Names several foods at once, joined by and or or", 0.95);
      splits(["Dijon mustard", "yellow mustard"], "alternatives", true);
      await askAIAbout(joined.ingredientId);

      expect(await lineFoods(named.line)).toEqual({
        joined: "alternatives",
        aliasIds: [dijon.aliasId, yellow.aliasId],
      });
      expect(await rowsOf(groceries)).toEqual([{ name: "Dijon mustard", aliasId: dijon.aliasId }]);
      expect(await pantryAliases()).toEqual([dijon.aliasId, yellow.aliasId].sort());
    });

    it("leaves a food AI is not sure names several as it was, flagged as unsure", async () => {
      const joined = await flagged("Dijon or yellow mustard");

      await kept("Dijon mustard");
      await kept("yellow mustard");
      reads({ englishName: null, generalFood: null, sure: false });
      decides("Names several foods at once, joined by and or or", 0.95);
      splits(["Dijon mustard", "yellow mustard"], "alternatives", false);

      await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-unsure",
      });
      await expect(ingredientFor(joined.aliasId)).resolves.toMatchObject({
        id: joined.ingredientId,
        flagged: true,
        flagReason: "ai-unsure",
      });
    });

    it("deletes a food AI is sure is a tool, its lines keeping their text, and Undo brings back the food and its rows", async () => {
      const roller = await flagged("deegroller");
      const named = await nameEverywhere(roller, "deegroller", { pantry: false });

      // Nothing known shares a word with it: the language model alone reads, then answers.
      reads({ englishName: null, generalFood: null, sure: true });
      compares("tool", null, true);

      await expect(askAIAbout(roller.ingredientId)).resolves.toMatchObject({ outcome: "tool" });
      expect(await exists(roller.ingredientId)).toBe(false);
      expect(await lineFoods(named.line)).toEqual({ joined: null, aliasIds: [] });
      expect(await rowsOf(groceries)).toEqual([{ name: "deegroller", aliasId: null }]);
      const [change, ...others] = await listAIChanges();

      expect(others).toEqual([]);
      expect(change).toMatchObject({
        sure: true,
        ingredient: null,
        undo: { kind: "tool", food: { ingredientId: roller.ingredientId, name: "deegroller" } },
      });

      await undoAIChange(actor, change!.id);
      await expect(ingredientFor(roller.aliasId)).resolves.toMatchObject({
        id: roller.ingredientId,
        name: "deegroller",
      });
      expect(await lineFoods(named.line)).toEqual({ joined: null, aliasIds: [roller.aliasId] });
      expect(await rowsOf(groceries)).toEqual([{ name: "deegroller", aliasId: roller.aliasId }]);
      expect(await rowsOf(recurringGroceries)).toEqual([
        { name: "deegroller", aliasId: roller.aliasId },
      ]);

      // Asked again, AI's same answer deletes it no more.
      reads({ englishName: null, generalFood: null, sure: true });
      compares("tool", null, true);
      await expect(askAIAbout(roller.ingredientId)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "undone",
      });
      expect(await exists(roller.ingredientId)).toBe(true);
    });

    it("deletes the lines of a food AI is sure names nothing as Junk Lines, which Undo puts back where they were", async () => {
      const melted = await flagged("melted");
      const bars = await kept("snickers bars");
      const cream = await kept("heavy cream");
      const recipe = await createTestRecipe(actor.userId, { name: "snickers ice cream bars" });

      for (const [order, food, text] of [
        [0, bars, "snickers bars"],
        [1, melted, "melted"],
        [2, cream, "heavy cream"],
      ] as const) {
        await insertTestRecipeLine({ recipeId: recipe.id, name: text, order: String(order) }, [
          food.aliasId,
        ]);
      }
      await getTestDb().insert(groceries).values({
        userId: actor.userId,
        name: "melted",
        ingredientAliasId: melted.aliasId,
        ingredientId: melted.ingredientId,
      });
      const linesOf = async () =>
        (
          await getTestDb()
            .select({ name: recipeIngredients.name })
            .from(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, recipe.id))
            .orderBy(asc(recipeIngredients.order))
        ).map((line) => line.name);

      reads({ englishName: null, generalFood: null, sure: true });
      compares("nothing", null, true);

      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "junk",
        lines: 1,
      });
      expect(await linesOf()).toEqual(["snickers bars", "heavy cream"]);
      expect(await exists(melted.ingredientId)).toBe(false);
      // A grocery a person typed is never deleted: it stays, naming no food.
      expect(await rowsOf(groceries)).toEqual([{ name: "melted", aliasId: null }]);
      expect(await changes()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "junk-line", food: null, sure: true }),
          expect.objectContaining({ kind: "not-a-food", food: null, sure: true }),
        ])
      );

      const junk = (await listAIChanges()).find((change) => change.undo.kind === "junk-line")!;

      expect(junk.recipe).toMatchObject({ id: recipe.id, name: "snickers ice cream bars" });
      await undoAIChange(actor, junk.id);
      expect(await linesOf()).toEqual(["snickers bars", "melted", "heavy cream"]);

      // Asked again about the same text, minted anew, AI deletes it no more.
      const again = await flagged("melted");

      reads({ englishName: null, generalFood: null, sure: true });
      compares("nothing", null, true);
      await expect(askAIAbout(again.ingredientId)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "undone",
      });
      expect(await exists(again.ingredientId)).toBe(true);
    });

    it("keeps a food AI deletes as naming nothing for Undo where a joined line still named it", async () => {
      const melted = await flagged("melted");
      const butter = await kept("butter");
      const recipe = await createTestRecipe(actor.userId);
      const line = await insertTestRecipeLine(
        { recipeId: recipe.id, name: "butter, melted", joined: "together" },
        [butter.aliasId, melted.aliasId]
      );

      reads({ englishName: null, generalFood: null, sure: true });
      compares("nothing", null, true);
      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "junk",
        lines: 0,
      });
      expect(await lineFoods(line.id)).toMatchObject({ aliasIds: [butter.aliasId] });

      const [change] = await listAIChanges();

      expect(change).toMatchObject({ undo: { kind: "not-a-food" } });
      await undoAIChange(actor, change!.id);
      expect(await lineFoods(line.id)).toMatchObject({
        aliasIds: [butter.aliasId, melted.aliasId],
      });
    });

    it("flags a food AI is not sure is a tool or names nothing with that doubt, deleting nothing", async () => {
      const roller = await flagged("deegroller");
      const melted = await flagged("melted");

      reads({ englishName: null, generalFood: null, sure: false });
      compares("tool", null, false);
      await expect(askAIAbout(roller.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-tool",
      });
      reads({ englishName: null, generalFood: null, sure: false });
      compares("nothing", null, false);
      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-junk",
      });

      await expect(ingredientFor(roller.aliasId)).resolves.toMatchObject({
        flagged: true,
        flagReason: "ai-tool",
      });
      await expect(ingredientFor(melted.aliasId)).resolves.toMatchObject({
        flagged: true,
        flagReason: "ai-junk",
      });
      expect(await changes()).toEqual([]);
    });

    it("keeps a food a Pantry Ingredient names, flagged, however sure AI is that it names nothing", async () => {
      const melted = await flagged("melted");

      await nameEverywhere(melted, "melted");
      reads({ englishName: null, generalFood: null, sure: true });
      compares("nothing", null, true);

      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-junk",
      });
      expect(await exists(melted.ingredientId)).toBe(true);
      expect(await pantryAliases()).toEqual([melted.aliasId]);
      await expect(
        getTestDb()
          .select({ id: recipeIngredients.id })
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.name, ["melted"]))
      ).resolves.toHaveLength(1);
    });
  });
});
