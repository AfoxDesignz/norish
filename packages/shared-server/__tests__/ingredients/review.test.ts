// @vitest-environment node
/**
 * Asking AI about an Ingredient after the fact, against a real database: AI
 * reads the name once, the reading is looked up as an import looks a name up,
 * and the answer is made, sure or not, and recorded as an AI Change; an unsure
 * one flags its food. The food itself is never its own answer, and a food a
 * person decided about, or a seeded one, is never asked about. The Decision
 * is mocked at `decide` and the language model at `generateStructured`.
 */
import { APICallError } from "ai";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionQuestions } from "@norish/shared-server/ai/runtime/runtime";
import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { withTransaction } from "@norish/db/drizzle";
import { listAIChanges } from "@norish/db/repositories/ingredient-ai-changes";
import {
  findIngredientAncestors,
  mergeCatalogueIngredients,
} from "@norish/db/repositories/ingredient-relocation";
import { applyIngredientSeed } from "@norish/db/repositories/ingredient-seed";
import {
  groceries,
  ingredientAliases,
  ingredients,
  pantryIngredients,
  recipeIngredientFoods,
  recipeIngredients,
  recurringGroceries,
} from "@norish/db/schema";
import {
  REQUEST_BUDGET_MS,
  RESOLUTION_THRESHOLD,
} from "@norish/shared-server/ai/resolution/ingredient-resolution";
import { AIProviderError } from "@norish/shared-server/ai/runtime/errors";
import { decide, generateStructured } from "@norish/shared-server/ai/runtime/runtime";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import {
  keepAIChange,
  listAIChangesFor,
  undoAIChange,
} from "@norish/shared-server/ingredients/ai-changes";
import {
  markDistinct,
  renameIngredient,
  setParent,
} from "@norish/shared-server/ingredients/catalogue";
import { onIngredientsMinted } from "@norish/shared-server/ingredients/minted";
import {
  findIngredientFor,
  ingredientFor,
  resolveIngredients,
} from "@norish/shared-server/ingredients/resolver";
import { askAIAbout } from "@norish/shared-server/ingredients/review";

import {
  createTestRecipe,
  getTestDb,
  insertTestRecipeLine,
  nameInATestRecipe,
} from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";
import { foodReading, noFoodReading, severalReading } from "../helpers/ingredient-readings";
import { seedEntry, seedEntryIn } from "../helpers/seed-entries";

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
 * What the language model answers, per prompt, in order: reading a name, picking among the foods
 * its reading found, and reading its Plain Name. A Plain Name nobody queued is null: AI found no
 * food in the name, so nothing is renamed.
 */
const modelAnswers: Record<string, unknown[]> = {};

function answers(prompt: "ingredient-resolution" | "ingredient-plain-name", answer: unknown) {
  (modelAnswers[prompt] ??= []).push(answer);
}

/** AI reads a name as one food. */
function reads(reading: Parameters<typeof foodReading>[0]) {
  answers("ingredient-resolution", foodReading(reading));
}

/** AI reads a name as several foods. */
function splits(
  parts: Parameters<typeof severalReading>[0],
  joined: "together" | "alternatives",
  sure: boolean
) {
  answers("ingredient-resolution", severalReading(parts, joined, sure));
}

/** AI reads a name as no food. */
function readsNoFood(sure: boolean) {
  answers("ingredient-resolution", noFoodReading(sure));
}

/** The language model's pick among the foods a reading found: the `food`th, or none. */
function picks(food: number | null, sure: boolean) {
  answers("ingredient-resolution", { food, sure });
}

/** How many questions went to AI about what a name is, the Decision's included. */
function resolutionRequests() {
  const asked = vi
    .mocked(generateStructured)
    .mock.calls.filter(([request]) => request.prompt === "ingredient-resolution");

  return asked.length + vi.mocked(decide).mock.calls.length;
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
    // Reset, not only re-stubbed: a `flagged` text that mints nothing leaves its once-off unread.
    vi.mocked(isAIEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(true);
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  /** A food minted while AI was off, flagged as the upgrade leaves them; no row names it. */
  async function unnamed(text: string) {
    vi.mocked(isAIEnabled).mockResolvedValueOnce(false);
    const [resolved] = await resolveIngredients([text], { userId: actor.userId });

    return resolved!;
  }

  /** `unnamed`, with a recipe line naming it. */
  async function flagged(text: string) {
    const food = await unnamed(text);

    await nameInATestRecipe(actor.userId, food.aliasId, text);

    return food;
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

  it("merges a food AI reads as a known one in one request, and raises no flag", async () => {
    const frankfurter = await kept("frankfurter");
    const knaks = await flagged("Unox Knaks");

    reads({ englishName: "frankfurter", parent: "sausage", sure: true });

    await expect(askAIAbout(knaks.ingredientId)).resolves.toMatchObject({
      outcome: "merge",
      into: "frankfurter",
      sure: true,
      englishName: "frankfurter",
      parent: "sausage",
      considered: [],
    });
    await expect(ingredientFor(knaks.aliasId)).resolves.toMatchObject({
      id: frankfurter.ingredientId,
      flagged: false,
    });
    expect(resolutionRequests()).toBe(1);
    expect(await changes()).toEqual([
      { kind: "merge", food: "frankfurter", target: null, sure: true, kept: false },
    ]);
  });

  it("looks the reading up as an import does: plurals, preparation and slips", async () => {
    const tomatoes = await kept("tomatoes");
    const zucchini = await kept("zucchini");
    const tomaat = await flagged("tomaat");
    const courgette = await flagged("courgette");

    reads({ englishName: "tomato, chopped", parent: null, sure: true });
    await expect(askAIAbout(tomaat.ingredientId)).resolves.toMatchObject({ outcome: "merge" });
    reads({ englishName: "zuchini", parent: null, sure: true });
    decides("Is zucchini", 0.95);
    await expect(askAIAbout(courgette.ingredientId)).resolves.toMatchObject({ outcome: "merge" });

    await expect(ingredientFor(tomaat.aliasId)).resolves.toMatchObject({
      id: tomatoes.ingredientId,
    });
    await expect(ingredientFor(courgette.aliasId)).resolves.toMatchObject({
      id: zucchini.ingredientId,
    });
  });

  it("looks up the other names AI says a shop sells the food under", async () => {
    await kept("hot dog sausage");
    const frank = await flagged("frankfurter");

    reads({
      englishName: "frankfurter",
      parent: null,
      otherNames: ["hot dog sausage", "wiener"],
      sure: true,
    });

    await expect(askAIAbout(frank.ingredientId)).resolves.toMatchObject({
      outcome: "merge",
      into: "hot dog sausage",
    });
  });

  it("merges a food AI is unsure is a known one too, and flags the food it joined", async () => {
    const onion = await kept("onion");
    const rings = await flagged("onion rings");

    reads({ englishName: "onion", parent: null, sure: false });

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

  it("files a food under the general food its reading names, when the catalogue has no food the name is", async () => {
    const onion = await kept("onion");
    const red = await flagged("rode uien");

    reads({ englishName: "red onion", parent: "onion", sure: true });

    await expect(askAIAbout(red.ingredientId)).resolves.toMatchObject({
      outcome: "parent",
      of: "onion",
      sure: true,
      englishName: "red onion",
    });
    await expect(parentOf(red.ingredientId)).resolves.toBe(onion.ingredientId);
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({
      id: red.ingredientId,
      flagged: false,
    });
    expect(resolutionRequests()).toBe(1);
    // A food under no parent is asked about its name alone.
    expect(vi.mocked(generateStructured).mock.calls[0]![0].sections).toEqual(["Name: rode uien"]);
    expect(await changes()).toMatchObject([{ kind: "parent", sure: true }]);
  });

  it("files a food under the parent AI is unsure of, flags it, and lists the change to keep or undo", async () => {
    const onion = await kept("onion");
    const red = await flagged("red onion");

    reads({ englishName: "red onion", parent: "onion", sure: false });

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

  it("calls a food AI is sure is its own one, its own spellings matching nothing, and gives it its Plain Name", async () => {
    await kept("onion");
    const spring = await flagged("Spring Onions Fresh");

    // "spring onion" is a plural away from the food's own spelling, which is no answer.
    reads({ englishName: "spring onion", parent: null, sure: true });
    answers("ingredient-plain-name", { plainName: "spring onions" });

    await expect(askAIAbout(spring.ingredientId)).resolves.toMatchObject({
      outcome: "rename",
      to: "spring onions",
    });
    await expect(ingredientFor(spring.aliasId)).resolves.toMatchObject({
      name: "spring onions",
      flagged: false,
    });
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    expect(await changes()).toMatchObject([{ kind: "plain-name", food: "spring onions" }]);
  });

  it("leaves a food AI is not sure is its own as it was, flagged as unsure", async () => {
    const thing = await flagged("Multitool deluxe");

    reads({ englishName: "multitool", parent: "tool", sure: false });

    await expect(askAIAbout(thing.ingredientId)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "ai-unsure",
      englishName: "multitool",
    });
    await expect(ingredientFor(thing.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-unsure",
    });
    expect(await changes()).toEqual([]);
  });

  describe("a food of its own whose words gave it a parent AI does not share", () => {
    /** A mint its words filed under the seeded butter. */
    async function underButter(text: string) {
      await applyIngredientSeed([seedEntry("en:butter", "butter")]);
      const food = await flagged(text);
      const butter = await parentOf(food.ingredientId);

      expect(butter).not.toBeNull();

      return { food, butter };
    }

    it("drops the parent, listed on Changed by AI to undo", async () => {
      const { food } = await underButter("peanut butter");

      reads({ englishName: "peanut butter", parent: "spread", sure: true });

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "no-parent",
        from: "butter",
        sure: true,
      });
      await expect(parentOf(food.ingredientId)).resolves.toBeNull();
      await expect(ingredientFor(food.aliasId)).resolves.toMatchObject({ flagged: false });
      expect(await changes()).toEqual([
        { kind: "parent", food: "peanut butter", target: null, sure: true, kept: false },
      ]);
      expect(await listAIChangesFor(actor)).toMatchObject([
        { kind: "parent", target: null, dropped: { name: "butter" }, canAct: true },
      ]);
    });

    it("puts the parent back on Undo, and AI leaves it when asked again", async () => {
      const { food, butter } = await underButter("peanut butter");

      reads({ englishName: "peanut butter", parent: null, sure: true });
      await askAIAbout(food.ingredientId);
      await undoAIChange(actor, (await listAIChanges())[0]!.id);
      await expect(parentOf(food.ingredientId)).resolves.toBe(butter);

      reads({ englishName: "peanut butter", parent: null, sure: true });
      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "undone",
      });
      await expect(parentOf(food.ingredientId)).resolves.toBe(butter);
    });

    it("drops the parent when unsure too, flagging the food, and Undo puts it back", async () => {
      const { food, butter } = await underButter("cookie butter");

      reads({ englishName: "cookie butter", parent: null, sure: false });

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "no-parent",
        sure: false,
      });
      await expect(parentOf(food.ingredientId)).resolves.toBeNull();
      await expect(ingredientFor(food.aliasId)).resolves.toMatchObject({
        flagged: true,
        flagReason: "ai-unsure",
      });
      expect(await changes()).toEqual([
        { kind: "parent", food: "cookie butter", target: null, sure: false, kept: false },
      ]);

      await undoAIChange(actor, (await listAIChanges())[0]!.id);
      await expect(parentOf(food.ingredientId)).resolves.toBe(butter);
    });

    it("never asks about a parent a person chose", async () => {
      const { food, butter } = await underButter("peanut butter");

      await setParent(actor, food.ingredientId, butter!);

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "decided",
      });
      await expect(parentOf(food.ingredientId)).resolves.toBe(butter);
    });

    it("says what it dropped as the food was when AI answered, and nothing where nothing was", async () => {
      const { food } = await underButter("peanut butter");

      // The parent goes while AI is still reading the name.
      vi.mocked(generateStructured).mockImplementationOnce((async () => {
        await getTestDb()
          .update(ingredients)
          .set({ parentId: null })
          .where(eq(ingredients.id, food.ingredientId));

        return foodReading({ englishName: "peanut butter", parent: null, sure: true });
      }) as never);

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
      expect(await changes()).toEqual([]);
    });

    it("lists and undoes a dropped parent merged into another food since as that food", async () => {
      const { food, butter } = await underButter("peanut butter");
      const spread = await kept("spread");

      reads({ englishName: "peanut butter", parent: null, sure: true });
      await askAIAbout(food.ingredientId);
      await withTransaction((tx) => mergeCatalogueIngredients(tx, butter!, spread.ingredientId));

      expect(await listAIChangesFor(actor)).toMatchObject([
        { kind: "parent", dropped: { id: spread.ingredientId } },
      ]);
      await undoAIChange(actor, (await listAIChanges())[0]!.id);
      await expect(parentOf(food.ingredientId)).resolves.toBe(spread.ingredientId);
    });
  });

  /** A mint its words filed under the seeded `parent`. */
  async function under(parent: string, text: string) {
    await applyIngredientSeed([seedEntry(`en:${parent}`, parent)]);
    const food = await flagged(text);
    const filed = await parentOf(food.ingredientId);

    expect(filed).not.toBeNull();

    return { food, filed };
  }

  describe("a food whose words filed it under a plain food it does share", () => {
    it("shows AI the parent the food is filed under, and keeps it when AI names it", async () => {
      const { food, filed } = await under("whey", "chocolate whey");

      reads({ englishName: "chocolate whey protein", parent: "whey", sure: true });

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        parent: "whey",
      });
      expect(vi.mocked(generateStructured).mock.calls[0]![0].sections).toEqual([
        "Name: chocolate whey",
        "Parent: whey",
      ]);
      await expect(parentOf(food.ingredientId)).resolves.toBe(filed);
      await expect(ingredientFor(food.aliasId)).resolves.toMatchObject({ flagged: false });
    });

    it("moves it to the plain food AI names when the catalogue has that food", async () => {
      const { food } = await under("spice", "chinese 5 spice");
      const mixed = await kept("mixed spices");

      reads({ englishName: "five spice powder", parent: "mixed spices", sure: true });

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "parent",
        of: "mixed spices",
      });
      await expect(parentOf(food.ingredientId)).resolves.toBe(mixed.ingredientId);
    });
  });

  describe("a food whose parent is a category", () => {
    it("keeps the category it is filed under when AI names it as the category", async () => {
      const { food, filed } = await under("spice", "chinese 5 spice");

      reads({ englishName: "five spice powder", parent: null, category: "spice", sure: true });

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({ category: "spice" });
      await expect(parentOf(food.ingredientId)).resolves.toBe(filed);
      expect(await changes()).toEqual([]);
    });

    it("files it under the category when the catalogue lacks the parent AI names", async () => {
      const food = await flagged("Cajun seasoning");

      await applyIngredientSeed([seedEntry("en:mixed-spices", "mixed spices")]);
      const [mixed] = await getTestDb()
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(eq(ingredients.name, "mixed spices"));

      reads({
        englishName: "Cajun seasoning",
        parent: "Cajun spice",
        category: "mixed spices",
        sure: true,
      });
      await askAIAbout(food.ingredientId);

      await expect(parentOf(food.ingredientId)).resolves.toBe(mixed!.id);
    });

    it("never files it under an own food the category names, a placeholder whose lines leave the choice to the cook", async () => {
      await kept("toppings");
      const food = await flagged("whipped topping");

      reads({ englishName: "whipped topping", parent: null, category: "toppings", sure: true });
      await askAIAbout(food.ingredientId);

      await expect(parentOf(food.ingredientId)).resolves.toBeNull();
    });

    it("drops the parent when the catalogue lacks the category too", async () => {
      const { food } = await under("fish", "Klop-Fix fish");

      reads({ englishName: "fish batter mix", parent: null, category: "baking mix", sure: true });

      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "no-parent",
        from: "fish",
      });
      await expect(parentOf(food.ingredientId)).resolves.toBeNull();
    });
  });

  describe("a reading that finds more than one food", () => {
    /** "tomaat", read as tomato, which a shop also sells as plum tomato: two foods. */
    async function twoFound() {
      const tomato = await kept("tomato");
      const plum = await kept("plum tomato");
      const tomaat = await flagged("tomaat");

      reads({
        englishName: "tomato",
        parent: null,
        otherNames: ["plum tomato"],
        sure: true,
      });

      return { tomato, plum, tomaat };
    }

    it("asks the Decision which, over just those foods, and acts at its threshold", async () => {
      const { tomato, tomaat } = await twoFound();
      const offered: string[] = [];

      decides("Is tomato", RESOLUTION_THRESHOLD, offered);

      await expect(askAIAbout(tomaat.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "tomato",
        sure: true,
        considered: expect.arrayContaining(["tomato", "plum tomato"]),
      });
      expect(offered.sort()).toEqual(["Is none of these", "Is plum tomato", "Is tomato"]);
      await expect(ingredientFor(tomaat.aliasId)).resolves.toMatchObject({
        id: tomato.ingredientId,
      });
      expect(resolutionRequests()).toBe(2);
    });

    it("asks the language model just below the threshold, and where the Decision is off", async () => {
      const { tomato, plum, tomaat } = await twoFound();

      decides("Is tomato", RESOLUTION_THRESHOLD - 0.01);
      picks(2, true);
      await askAIAbout(tomaat.ingredientId);
      await expect(ingredientFor(tomaat.aliasId)).resolves.toMatchObject({ id: plum.ingredientId });

      const pomodoro = await flagged("pomodoro");

      vi.mocked(decide).mockClear();
      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      reads({ englishName: "tomato", parent: null, otherNames: ["plum tomato"], sure: true });
      picks(1, false);
      await expect(askAIAbout(pomodoro.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "tomato",
        sure: false,
      });
      expect(vi.mocked(decide)).not.toHaveBeenCalled();
      await expect(ingredientFor(pomodoro.aliasId)).resolves.toMatchObject({
        id: tomato.ingredientId,
        flagged: true,
      });
    });

    it("leaves a food that is none of them a food of its own", async () => {
      const { tomaat } = await twoFound();

      decides("Is none of these", 0.95);

      await expect(askAIAbout(tomaat.ingredientId)).resolves.toMatchObject({
        outcome: "distinct",
      });
      await expect(ingredientFor(tomaat.aliasId)).resolves.toMatchObject({
        id: tomaat.ingredientId,
        flagged: false,
      });
    });

    it("flags a food the language model is not sure is none of them", async () => {
      const { tomaat } = await twoFound();

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      picks(null, false);

      await expect(askAIAbout(tomaat.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-unsure",
      });
      await expect(ingredientFor(tomaat.aliasId)).resolves.toMatchObject({
        id: tomaat.ingredientId,
        flagged: true,
      });
    });
  });

  describe("a reading only a slip of the fingers finds", () => {
    /** The numbered foods the language model's second question listed. */
    function listed() {
      const [, second] = vi
        .mocked(generateStructured)
        .mock.calls.filter(([request]) => request.prompt === "ingredient-resolution");

      return second?.[0].sections?.find((section) => section.startsWith("Foods in the catalogue"));
    }

    /** "red port", filed under "port", that a Dutch and an Italian spelling also name. */
    async function redPort() {
      const port = await kept("port");
      const red = await kept("red port");

      await setParent(actor, red.ingredientId, port.ingredientId);
      await getTestDb()
        .insert(ingredientAliases)
        .values(
          ["rode port", "porto rosso"].map((text) => ({
            text,
            fold: text,
            ingredientId: red.ingredientId,
          }))
        );

      return red;
    }

    it("asks the language model with AI's reading and the spelling that found each food", async () => {
      await redPort();
      const pesto = await flagged("rode pesto");

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      reads({
        englishName: "red pesto",
        parent: "pesto",
        category: "sauce",
        otherNames: ["pesto rosso"],
        sure: true,
      });
      picks(null, true);

      await expect(askAIAbout(pesto.ingredientId)).resolves.toMatchObject({
        outcome: "distinct",
      });
      const [, second] = vi
        .mocked(generateStructured)
        .mock.calls.filter(([request]) => request.prompt === "ingredient-resolution");

      expect(second?.[0].sections).toEqual([
        "Name: rode pesto",
        "English name: red pesto",
        "Parent: pesto",
        "Category: sauce",
        "Foods in the catalogue it may be:\n1. red port (parent: port; matched: porto rosso; also: rode port)",
      ]);
    });

    it("gives the Decision AI's reading and the spelling that found each food", async () => {
      await redPort();
      const pesto = await flagged("rode pesto");

      reads({ englishName: "red pesto", parent: "pesto", otherNames: ["pesto rosso"], sure: true });
      decides("Is none of these", 0.9);

      await expect(askAIAbout(pesto.ingredientId)).resolves.toMatchObject({
        outcome: "distinct",
      });
      expect(vi.mocked(decide).mock.calls[0]?.[0].state).toEqual({
        name: "rode pesto",
        englishName: "red pesto",
        parent: "pesto",
        foods: [
          { name: "red port", parent: "port", matched: "porto rosso", alsoKnownAs: ["rode port"] },
        ],
      });
    });

    it("asks AI about the one food found, and keeps a food that is none of them its own", async () => {
      const port = await kept("porto rosso");
      const pesto = await flagged("rode pesto");

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      reads({ englishName: "red pesto", parent: "pesto", otherNames: ["pesto rosso"], sure: true });
      picks(null, true);

      await expect(askAIAbout(pesto.ingredientId)).resolves.toMatchObject({
        outcome: "distinct",
        considered: ["porto rosso"],
      });
      expect(listed()).toBe("Foods in the catalogue it may be:\n1. porto rosso");
      await expect(ingredientFor(pesto.aliasId)).resolves.toMatchObject({
        id: pesto.ingredientId,
        flagged: false,
      });
      expect(port.ingredientId).not.toBe(pesto.ingredientId);
    });

    it("lists every food within a slip, the nearest first", async () => {
      await kept("sambal olie");
      await kept("sambal oelek");
      const sauce = await flagged("sambel");

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      reads({ englishName: "sambal olek", parent: null, sure: true });
      picks(null, true);

      await expect(askAIAbout(sauce.ingredientId)).resolves.toMatchObject({
        outcome: "distinct",
      });
      expect(listed()).toBe("Foods in the catalogue it may be:\n1. sambal oelek\n2. sambal olie");
    });

    it("merges into a slip the Decision picks at 90% or more, sure", async () => {
      const tortilla = await kept("tortilla");
      const tortillas = await flagged("maïstortilla");

      reads({ englishName: "tortila", parent: null, sure: true });
      decides("Is tortilla", 0.97);

      await expect(askAIAbout(tortillas.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "tortilla",
        sure: true,
      });
      await expect(ingredientFor(tortillas.aliasId)).resolves.toMatchObject({
        id: tortilla.ingredientId,
        flagged: false,
      });
    });

    it("merges into a slip the Decision picks below 90%, unsure, so a person checks it", async () => {
      const tortilla = await kept("tortilla");
      const tortillas = await flagged("maïstortilla");

      reads({ englishName: "tortila", parent: null, sure: true });
      decides("Is tortilla", 0.85);

      await expect(askAIAbout(tortillas.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "tortilla",
        sure: false,
      });
      await expect(ingredientFor(tortillas.aliasId)).resolves.toMatchObject({
        id: tortilla.ingredientId,
        flagged: true,
      });
    });

    it("merges into a slip the language model picks sure, sure", async () => {
      const tortilla = await kept("tortilla");
      const tortillas = await flagged("maïstortilla");

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      reads({ englishName: "tortila", parent: null, sure: true });
      picks(1, true);

      await expect(askAIAbout(tortillas.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "tortilla",
        sure: true,
      });
      await expect(ingredientFor(tortillas.aliasId)).resolves.toMatchObject({
        id: tortilla.ingredientId,
        flagged: false,
      });
    });

    it("takes an exact match beside a slip without a second question", async () => {
      const pesto = await kept("red pesto");

      await kept("red port");
      const rode = await flagged("rode pesto");

      reads({ englishName: "red pesto", parent: null, otherNames: ["red pest"], sure: true });

      await expect(askAIAbout(rode.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "red pesto",
        sure: true,
      });
      expect(resolutionRequests()).toBe(1);
      await expect(ingredientFor(rode.aliasId)).resolves.toMatchObject({
        id: pesto.ingredientId,
      });
    });

    it("asks about a parent only a slip finds, and files it under the one AI picks, unsure as AI is", async () => {
      const tortilla = await kept("tortilla");
      const wrap = await flagged("maïswrap");

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      reads({ englishName: "corn wrap", parent: "tortila", sure: true });
      picks(null, true);
      await expect(askAIAbout(wrap.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
      expect(listed()).toBe("Foods in the catalogue it may be:\n1. tortilla");
      await expect(parentOf(wrap.ingredientId)).resolves.toBeNull();

      const flour = await flagged("bloemwrap");

      reads({ englishName: "flour wrap", parent: "tortila", sure: true });
      picks(1, false);
      await expect(askAIAbout(flour.ingredientId)).resolves.toMatchObject({
        outcome: "parent",
        of: "tortilla",
        sure: false,
      });
      await expect(parentOf(flour.ingredientId)).resolves.toBe(tortilla.ingredientId);
    });

    it("never files a food under a hidden one", async () => {
      await unnamed("rye bread");
      const whole = await flagged("volkoren roggebrood");

      reads({ englishName: "wholegrain rye bread", parent: "rye bread", sure: true });
      await expect(askAIAbout(whole.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
      await expect(parentOf(whole.ingredientId)).resolves.toBeNull();
    });
  });

  describe("a name that is a food's own", () => {
    it("AI's parent jam files under the food jam, not yam (whose hr spelling is jam)", async () => {
      // As the seed left it before ticket 32: yam's Croatian spelling took the fold of jam's name.
      await applyIngredientSeed([
        seedEntry("en:yam", "yam", "jam"),
        { ...seedEntry("en:jam", "confiture"), name: "jam", nameFold: "jam" },
      ]);
      const hero = await flagged("Hero Bosvruchtenjam");

      reads({ englishName: "forest fruit jam", parent: "jam", sure: true });

      await expect(askAIAbout(hero.ingredientId)).resolves.toMatchObject({
        outcome: "parent",
        of: "jam",
        sure: true,
      });
      expect(resolutionRequests()).toBe(1);
    });
  });

  describe("AI's names, looked up as written", () => {
    /** The food a recipe line's text now means, and its parent's id. */
    async function landed(food: { aliasId: string; ingredientId: string }) {
      const row = await ingredientFor(food.aliasId);

      return { same: row?.id === food.ingredientId, parent: await parentOf(food.ingredientId) };
    }

    it("keeps baby potatoes its own food under potato: petite potatoes is not potatoes", async () => {
      await applyIngredientSeed([seedEntry("en:potato", "potato", "potatoes")]);
      const potato = (await findIngredientFor("potatoes"))!;
      const baby = await flagged("baby potatoes");

      reads({
        englishName: "baby potatoes",
        parent: "potato",
        otherNames: ["mini potatoes", "petite potatoes"],
        sure: true,
      });

      await askAIAbout(baby.ingredientId);
      await expect(landed(baby)).resolves.toEqual({ same: true, parent: potato.ingredientId });
      expect(resolutionRequests()).toBe(1);
    });

    it("merges mini-krieltjes into the own food baby potatoes its English name is", async () => {
      await applyIngredientSeed([seedEntry("en:potato", "potato", "potatoes")]);
      const baby = await kept("baby potatoes");
      const krieltjes = await flagged("mini-krieltjes");

      reads({
        englishName: "baby potatoes",
        parent: "potato",
        otherNames: ["small potatoes", "petite potatoes"],
        sure: true,
      });

      await expect(askAIAbout(krieltjes.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "baby potatoes",
        sure: true,
      });
      await expect(ingredientFor(krieltjes.aliasId)).resolves.toMatchObject({
        id: baby.ingredientId,
      });
      expect(resolutionRequests()).toBe(1);
    });

    it("files red pepper flakes under chili pepper: crushed red pepper is not red bell pepper's red pepper", async () => {
      await applyIngredientSeed([
        seedEntry("en:red-bell-pepper", "red bell pepper", "red pepper"),
        seedEntry("en:chili-pepper", "chili pepper"),
      ]);
      const chili = (await findIngredientFor("chili pepper"))!;
      const flakes = await flagged("red pepper flakes");

      reads({
        englishName: "red pepper flakes",
        parent: "chili pepper",
        otherNames: ["crushed red pepper", "red chili flakes"],
        sure: true,
      });

      await expect(askAIAbout(flakes.ingredientId)).resolves.toMatchObject({
        outcome: "parent",
        of: "chili pepper",
      });
      await expect(landed(flakes)).resolves.toEqual({ same: true, parent: chili.ingredientId });
    });

    it("keeps deli ham its own food under ham: sliced ham is not ham", async () => {
      await applyIngredientSeed([seedEntry("en:ham", "ham")]);
      const ham = (await findIngredientFor("ham"))!;
      const deli = await flagged("deli ham");

      reads({
        englishName: "deli ham",
        parent: "ham",
        otherNames: ["sliced ham", "lunch meat ham"],
        sure: true,
      });

      await askAIAbout(deli.ingredientId);
      await expect(landed(deli)).resolves.toEqual({ same: true, parent: ham.ingredientId });
    });

    it("still merges italian sausage into sausage, whose own spelling salsiccia AI names", async () => {
      await applyIngredientSeed([seedEntry("en:sausage", "sausage", "salsiccia")]);
      const italian = await flagged("italian sausage");

      reads({
        englishName: "Italian sausage",
        parent: "sausage",
        otherNames: ["Italian-style sausage", "salsiccia"],
        sure: true,
      });

      await expect(askAIAbout(italian.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "sausage",
        sure: true,
      });
    });
  });

  describe("a spelling in a language Norish does not read", () => {
    it("finds no parent: AI's bun is not pear's Volapük bün, nor salam salami's Czech salám", async () => {
      await applyIngredientSeed([
        seedEntryIn("en:pear", ["pear", "en"], ["bün", "vo"]),
        seedEntryIn("en:salami", ["salami", "en"], ["salám", "cs"]),
      ]);
      const buns = await flagged("burger buns");
      const salam = await flagged("salam blaadjes");

      reads({ englishName: "burger buns", parent: "bun", sure: true });
      reads({ englishName: "salam leaves", parent: "salam", sure: true });
      // Salam is a slip from salami's English name, so that is asked about, not taken.
      picks(null, true);

      await expect(askAIAbout(buns.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
      await expect(askAIAbout(salam.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
      await expect(parentOf(buns.ingredientId)).resolves.toBeNull();
      await expect(parentOf(salam.ingredientId)).resolves.toBeNull();
    });
  });

  describe("an answer that breaks its shape", () => {
    /** A name read as several foods that names only one. */
    const broken = () => severalReading(["onion"], "together", true);

    it("is asked once more, and the second answer is made", async () => {
      const onion = await kept("onion");
      const uien = await flagged("uien");

      answers("ingredient-resolution", broken());
      reads({ englishName: "onion", sure: true });

      await expect(askAIAbout(uien.ingredientId)).resolves.toMatchObject({ outcome: "merge" });
      expect(resolutionRequests()).toBe(2);
      await expect(ingredientFor(uien.aliasId)).resolves.toMatchObject({
        id: onion.ingredientId,
      });
    });

    it("flags the food when the second answer breaks it too", async () => {
      await kept("onion");
      const uien = await flagged("uien");

      answers("ingredient-resolution", broken());
      answers("ingredient-resolution", {
        ...noFoodReading(true),
        action: { kind: "not-a-food", joined: null, reason: null },
      });

      await expect(askAIAbout(uien.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-unavailable",
      });
      expect(resolutionRequests()).toBe(2);
      await expect(ingredientFor(uien.aliasId)).resolves.toMatchObject({
        id: uien.ingredientId,
        flagged: true,
        flagReason: "ai-unavailable",
      });
    });
  });

  it("leaves the food and its changes as they were when no answer comes, the flag saying why", async () => {
    await kept("onion");
    const red = await flagged("red onion");

    reads({ englishName: "red onion", parent: "onion", sure: false });
    await askAIAbout(red.ingredientId);
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

  it("says AI is off on a food that was waiting on its pass when AI was switched off", async () => {
    const red = await flagged("red onion");

    await getTestDb()
      .update(ingredients)
      .set({ flagReason: "ai-queued" })
      .where(eq(ingredients.id, red.ingredientId));
    vi.mocked(isAIEnabled).mockResolvedValue(false);

    await askAIAbout(red.ingredientId);
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagReason: "ai-off" });
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
    expect(resolutionRequests()).toBe(0);
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
  });

  it("asks nothing about a grocery food, nor an own food nothing names, until a recipe line names it", async () => {
    const reserve = await unnamed("Nora reserve eten");
    const loose = await unnamed("kokosbloesemsuiker");

    await getTestDb().insert(groceries).values({
      userId: actor.userId,
      name: "Nora reserve eten",
      ingredientAliasId: reserve.aliasId,
      ingredientId: reserve.ingredientId,
    });

    for (const food of [reserve, loose]) {
      await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "decided",
      });
    }
    expect(resolutionRequests()).toBe(0);

    await nameInATestRecipe(actor.userId, reserve.aliasId, "Nora reserve eten");
    reads({ englishName: "Nora reserve food", sure: true });

    await expect(askAIAbout(reserve.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
    expect(resolutionRequests()).toBe(1);
  });

  it("never merges a food into a hidden one", async () => {
    await unnamed("rye bread");
    const rogge = await flagged("roggebrood");

    reads({ englishName: "rye bread", parent: null, sure: true });
    await expect(askAIAbout(rogge.ingredientId)).resolves.toMatchObject({ outcome: "distinct" });
    await expect(ingredientFor(rogge.aliasId)).resolves.toMatchObject({ id: rogge.ingredientId });
  });

  it("never makes a merge or a parent a person undid again", async () => {
    const onion = await kept("onion");
    const bulbs = await flagged("onion bulbs");
    const red = await flagged("red onion");

    reads({ englishName: "onion", parent: null, sure: true });
    await askAIAbout(bulbs.ingredientId);
    reads({ englishName: "red onion", parent: "onion", sure: true });
    await askAIAbout(red.ingredientId);
    for (const change of await listAIChanges()) await undoAIChange(actor, change.id);

    const restored = (await ingredientFor(bulbs.aliasId))!;

    reads({ englishName: "onion", parent: null, sure: true });
    await expect(askAIAbout(restored.id)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "undone",
    });
    reads({ englishName: "red onion", parent: "onion", sure: true });
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

    reads({ englishName: "red onion", parent: "onion", sure: false });
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

  it("says the key was refused when the provider refused it", async () => {
    await kept("garlic");
    const cloves = await flagged("garlic cloves");
    const refused = new AIProviderError("The AI provider rejected the configured API key.", {
      retryable: false,
      cause: new APICallError({
        message: "Incorrect API key provided",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 401,
      }),
    });

    answers("ingredient-resolution", refused);

    await expect(askAIAbout(cloves.ingredientId)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "ai-key-rejected",
    });
    await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({
      flagReason: "ai-key-rejected",
    });
  });

  describe("a request that runs out of time", () => {
    /** What the runtime throws when a request outlasts its `timeoutMs`. */
    const timedOut = () =>
      new AIProviderError("The AI request timed out.", {
        retryable: true,
        cause: new DOMException("The operation timed out.", "TimeoutError"),
      });

    it("gives each request its own budget, and asks a reading once more after it timed out", async () => {
      const garlic = await kept("garlic");
      const cloves = await flagged("garlic cloves");

      answers("ingredient-resolution", timedOut());
      reads({ englishName: "garlic", sure: true });

      await expect(askAIAbout(cloves.ingredientId)).resolves.toMatchObject({ outcome: "merge" });
      expect(resolutionRequests()).toBe(2);
      expect(vi.mocked(generateStructured)).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "ingredient-resolution", timeoutMs: REQUEST_BUDGET_MS })
      );
      await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({
        id: garlic.ingredientId,
      });
    });

    it("flags a food as unanswered when the reading times out twice", async () => {
      await kept("garlic");
      const cloves = await flagged("garlic cloves");

      answers("ingredient-resolution", timedOut());
      answers("ingredient-resolution", timedOut());

      await expect(askAIAbout(cloves.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-unavailable",
      });
      expect(resolutionRequests()).toBe(2);
    });

    it("asks once more for a timeout and once more for a broken shape, never more", async () => {
      await kept("onion");
      const uien = await flagged("uien");

      answers("ingredient-resolution", timedOut());
      answers("ingredient-resolution", severalReading(["onion"], "together", true));
      answers("ingredient-resolution", timedOut());

      await expect(askAIAbout(uien.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-unavailable",
      });
      expect(resolutionRequests()).toBe(3);
    });

    it("falls back to the language model when the Decision times out, which is asked once more too", async () => {
      const tomato = await kept("tomato");

      await kept("plum tomato");
      const tomaat = await flagged("tomaat");

      reads({ englishName: "tomato", parent: null, otherNames: ["plum tomato"], sure: true });
      vi.mocked(decide).mockRejectedValueOnce(timedOut());
      answers("ingredient-resolution", timedOut());
      picks(1, true);

      await expect(askAIAbout(tomaat.ingredientId)).resolves.toMatchObject({
        outcome: "merge",
        into: "tomato",
      });
      expect(vi.mocked(decide)).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: REQUEST_BUDGET_MS })
      );
      expect(resolutionRequests()).toBe(4);
      await expect(ingredientFor(tomaat.aliasId)).resolves.toMatchObject({
        id: tomato.ingredientId,
      });
    });
  });

  describe("several foods, and not a food", () => {
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

    it("splits foods written side by side, finding each part by its English name and other names", async () => {
      const joined = await flagged("koud water melk");
      const water = await kept("water");
      const milk = await kept("milk");
      const named = await nameEverywhere(joined, "koud water melk", { pantry: false });

      splits(
        [
          { written: "koud water", englishName: "cold water", otherNames: ["water"] },
          { written: "melk", englishName: "milk" },
        ],
        "together",
        true
      );

      await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
        outcome: "split",
        into: ["koud water", "melk"],
        parts: ["koud water", "melk"],
      });
      expect(await lineFoods(named.line)).toEqual({
        joined: "together",
        aliasIds: [water.aliasId, milk.aliasId],
      });
      // Each grocery keeps its part as written.
      expect(await rowsOf(groceries)).toEqual([
        { name: "koud water", aliasId: water.aliasId },
        { name: "melk", aliasId: milk.aliasId },
      ]);
      expect(await exists(joined.ingredientId)).toBe(false);
    });

    it("splits a food into parts nothing knows, minting them flagged for passes of their own", async () => {
      const joined = await flagged("Dijon or yellow mustard");
      const named = await nameEverywhere(joined, "Dijon or yellow mustard", { pantry: false });
      const minted: string[] = [];

      splits(["Dijon mustard", "yellow mustard"], "alternatives", true);
      onIngredientsMinted(async (ids) => void minted.push(...ids));
      try {
        await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
          outcome: "split",
          into: ["Dijon mustard", "yellow mustard"],
        });
      } finally {
        onIngredientsMinted(undefined);
      }

      const { joined: how, aliasIds } = await lineFoods(named.line);
      const parts = await Promise.all(aliasIds.map((aliasId) => ingredientFor(aliasId!)));

      expect(how).toBe("alternatives");
      expect(parts).toMatchObject([
        { name: "Dijon mustard", flagged: true, flagReason: "ai-queued" },
        { name: "yellow mustard", flagged: true, flagReason: "ai-queued" },
      ]);
      expect(minted.sort()).toEqual(parts.map((part) => part!.id).sort());
      expect(await exists(joined.ingredientId)).toBe(false);
    });

    describe("a part AI's names find only a slip for", () => {
      /** Barley, also spelled "garagar", which "agar agar" is a slip of. */
      async function barley() {
        const food = await kept("barley");

        await getTestDb()
          .insert(ingredientAliases)
          .values({ text: "garagar", fold: "garagar", ingredientId: food.ingredientId });

        return food;
      }

      it("mints the part where the second question answers none, never taking the slip", async () => {
        const grain = await barley();
        const joined = await flagged("vegatine of agar agar");
        const named = await nameEverywhere(joined, "vegatine of agar agar", { pantry: false });
        const minted: string[] = [];

        splits(["vegatine", "agar agar"], "alternatives", true);
        decides("Is none of these", 0.98);
        onIngredientsMinted(async (ids) => void minted.push(...ids));
        try {
          await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
            outcome: "split",
            into: ["vegatine", "agar agar"],
            considered: ["barley"],
          });
        } finally {
          onIngredientsMinted(undefined);
        }

        const parts = await Promise.all(
          (await lineFoods(named.line)).aliasIds.map((aliasId) => ingredientFor(aliasId!))
        );

        expect(parts).toMatchObject([
          { name: "vegatine", flagReason: "ai-queued" },
          { name: "agar agar", flagReason: "ai-queued" },
        ]);
        expect(minted).toContain(parts[1]!.id);
        const barleySpellings = await getTestDb()
          .select({ text: ingredientAliases.text })
          .from(ingredientAliases)
          .where(eq(ingredientAliases.ingredientId, grain.ingredientId));

        expect(barleySpellings.map((row) => row.text).sort()).toEqual(["barley", "garagar"]);
      });

      it("splits the part onto the slip the second question picks", async () => {
        const grain = await barley();
        const joined = await flagged("vegatine of agar agar");
        const named = await nameEverywhere(joined, "vegatine of agar agar", { pantry: false });

        splits(["vegatine", "agar agar"], "alternatives", true);
        decides("Is barley", 0.95);

        await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
          outcome: "split",
        });
        const [, part] = await Promise.all(
          (await lineFoods(named.line)).aliasIds.map((aliasId) => ingredientFor(aliasId!))
        );

        expect(part).toMatchObject({ id: grain.ingredientId });
      });
    });

    describe("a joined food that holds one part's spelling", () => {
      async function joinedHoldingCream() {
        const cream = await flagged("light cooking cream");
        const joined = await flagged("light cooking cream or non-fat Greek yogurt");

        await withTransaction((tx) =>
          mergeCatalogueIngredients(tx, cream.ingredientId, joined.ingredientId, {
            keepFlag: true,
          })
        );

        const yogurt = await kept("greek yogurt");

        return { cream: { ...cream, ingredientId: joined.ingredientId }, joined, yogurt };
      }

      const reading = [
        { written: "light cooking cream", englishName: "light cooking cream" },
        { written: "non-fat Greek yogurt", englishName: "greek yogurt" },
      ];

      it("moves the spelling and its lines to a food of its own, and splits the rest", async () => {
        const { cream, joined, yogurt } = await joinedHoldingCream();
        const both = await nameEverywhere(joined, "light cooking cream or non-fat Greek yogurt", {
          pantry: false,
        });
        const alone = await nameEverywhere(cream, "light cooking cream", { pantry: false });
        const minted: string[] = [];

        splits(reading, "alternatives", true);
        onIngredientsMinted(async (ids) => void minted.push(...ids));
        try {
          await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
            outcome: "split",
            into: ["light cooking cream", "non-fat Greek yogurt"],
          });
        } finally {
          onIngredientsMinted(undefined);
        }

        const creamFood = await ingredientFor(cream.aliasId);

        expect(creamFood).toMatchObject({
          name: "light cooking cream",
          flagged: true,
          flagReason: "ai-queued",
        });
        expect(creamFood!.id).not.toBe(joined.ingredientId);
        expect(minted).toEqual([creamFood!.id]);
        expect(await lineFoods(both.line)).toEqual({
          joined: "alternatives",
          aliasIds: [cream.aliasId, yogurt.aliasId],
        });
        expect(await lineFoods(alone.line)).toEqual({ joined: null, aliasIds: [cream.aliasId] });
        expect(
          (await rowsOf(groceries)).filter((row) => row.name === "light cooking cream")
        ).toEqual([
          { name: "light cooking cream", aliasId: cream.aliasId },
          { name: "light cooking cream", aliasId: cream.aliasId },
        ]);
        expect(await exists(joined.ingredientId)).toBe(false);
      });

      it("moves the spelling to the food already named for it", async () => {
        const { cream, joined } = await joinedHoldingCream();
        // A Plain Name can give another food that name while the joined food keeps the spelling.
        const named = await kept("cooking cream, light");

        await getTestDb()
          .update(ingredients)
          .set({ name: "Light cooking cream" })
          .where(eq(ingredients.id, named.ingredientId));
        splits(reading, "alternatives", true);

        await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({ outcome: "split" });
        await expect(ingredientFor(cream.aliasId)).resolves.toMatchObject({
          id: named.ingredientId,
        });
        expect(await exists(joined.ingredientId)).toBe(false);
      });

      it("leaves it whole, flagged, when the food is itself named for the spelling", async () => {
        const { cream, joined } = await joinedHoldingCream();
        const line = await nameEverywhere(cream, "light cooking cream", { pantry: false });

        await getTestDb()
          .update(ingredients)
          .set({ name: "Light cooking cream" })
          .where(eq(ingredients.id, joined.ingredientId));
        splits(reading, "alternatives", true);

        await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
          outcome: "unsure",
          reason: "ai-unsure",
        });
        expect(await exists(joined.ingredientId)).toBe(true);
        expect(await lineFoods(line.line)).toEqual({ joined: null, aliasIds: [cream.aliasId] });
        await expect(ingredientFor(cream.aliasId)).resolves.toMatchObject({
          id: joined.ingredientId,
          flagged: true,
        });
      });

      it("names the food once where the food named for the spelling is another part", async () => {
        const { cream, joined, yogurt } = await joinedHoldingCream();

        await getTestDb()
          .update(ingredients)
          .set({ name: "Light cooking cream" })
          .where(eq(ingredients.id, yogurt.ingredientId));
        await nameEverywhere(joined, "light cooking cream and non-fat Greek yogurt", {
          pantry: false,
        });
        splits(reading, "together", true);

        await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({ outcome: "split" });
        await expect(ingredientFor(cream.aliasId)).resolves.toMatchObject({
          id: yogurt.ingredientId,
        });
        expect(await rowsOf(groceries)).toEqual([
          { name: "light cooking cream", aliasId: cream.aliasId },
        ]);
      });

      it("leaves it whole when AI is not sure", async () => {
        const { cream, joined } = await joinedHoldingCream();

        splits(reading, "alternatives", false);
        await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
          outcome: "unsure",
        });
        await expect(ingredientFor(cream.aliasId)).resolves.toMatchObject({
          id: joined.ingredientId,
        });
      });
    });

    it("puts the first of a split's alternatives on the list, and keeps each in the Pantry", async () => {
      const joined = await flagged("Dijon or yellow mustard");
      const dijon = await kept("Dijon mustard");
      const yellow = await kept("yellow mustard");
      const named = await nameEverywhere(joined, "Dijon or yellow mustard");

      splits(["Dijon mustard", "yellow mustard"], "alternatives", true);
      await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
        outcome: "split",
        into: ["Dijon mustard", "yellow mustard"],
        parts: ["Dijon mustard", "yellow mustard"],
      });
      expect(resolutionRequests()).toBe(1);

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
      splits(["Dijon mustard", "yellow mustard"], "alternatives", false);

      await expect(askAIAbout(joined.ingredientId)).resolves.toMatchObject({
        outcome: "unsure",
        reason: "ai-unsure",
        parts: ["Dijon mustard", "yellow mustard"],
      });
      expect(resolutionRequests()).toBe(1);
      await expect(ingredientFor(joined.aliasId)).resolves.toMatchObject({
        id: joined.ingredientId,
        flagged: true,
        flagReason: "ai-unsure",
      });
    });

    it("deletes a food AI is sure is not a food, its lines keeping their text, and Undo brings back the food and its rows", async () => {
      const roller = await flagged("deegroller");
      const named = await nameEverywhere(roller, "deegroller", { pantry: false });

      readsNoFood(true);

      await expect(askAIAbout(roller.ingredientId)).resolves.toMatchObject({
        outcome: "not-a-food",
      });
      expect(await exists(roller.ingredientId)).toBe(false);
      expect(await lineFoods(named.line)).toEqual({ joined: null, aliasIds: [] });
      expect(await rowsOf(groceries)).toEqual([{ name: "deegroller", aliasId: null }]);
      const [change, ...others] = await listAIChanges();

      expect(others).toEqual([]);
      expect(change).toMatchObject({
        sure: true,
        ingredient: null,
        undo: {
          kind: "not-a-food",
          food: { ingredientId: roller.ingredientId, name: "deegroller" },
        },
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
      readsNoFood(true);
      await expect(askAIAbout(roller.ingredientId)).resolves.toMatchObject({
        outcome: "skipped",
        reason: "undone",
      });
      expect(await exists(roller.ingredientId)).toBe(true);
    });

    it("keeps every line of a recipe when AI deletes a food one names, the line pointing at no food until Undo", async () => {
      const melted = await flagged("melted");
      const bars = await kept("snickers bars");
      const cream = await kept("heavy cream");
      const recipe = await createTestRecipe(actor.userId, { name: "snickers ice cream bars" });
      const lines = [];

      for (const [order, food, text] of [
        [0, bars, "snickers bars"],
        [1, melted, "melted"],
        [2, cream, "heavy cream"],
      ] as const) {
        lines.push(
          await insertTestRecipeLine({ recipeId: recipe.id, name: text, order: String(order) }, [
            food.aliasId,
          ])
        );
      }
      const linesOf = async () =>
        (
          await getTestDb()
            .select({ name: recipeIngredients.name })
            .from(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, recipe.id))
            .orderBy(asc(recipeIngredients.order))
        ).map((line) => line.name);

      readsNoFood(true);

      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "not-a-food",
      });
      expect(await linesOf()).toEqual(["snickers bars", "melted", "heavy cream"]);
      expect(await lineFoods(lines[1]!.id)).toEqual({ joined: null, aliasIds: [] });
      expect(await exists(melted.ingredientId)).toBe(false);
      expect(await changes()).toEqual([
        expect.objectContaining({ kind: "not-a-food", food: null, sure: true }),
      ]);

      const [change] = await listAIChanges();

      await undoAIChange(actor, change!.id);
      expect(await lineFoods(lines[1]!.id)).toEqual({ joined: null, aliasIds: [melted.aliasId] });
      expect(await linesOf()).toEqual(["snickers bars", "melted", "heavy cream"]);
    });

    it("closes up a joined line when AI deletes one of its foods, and Undo puts the food back in its place", async () => {
      const melted = await flagged("melted");
      const butter = await kept("butter");
      const recipe = await createTestRecipe(actor.userId);
      const line = await insertTestRecipeLine(
        { recipeId: recipe.id, name: "butter, melted", joined: "together" },
        [butter.aliasId, melted.aliasId]
      );

      readsNoFood(true);
      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "not-a-food",
      });
      expect(await lineFoods(line.id)).toMatchObject({ aliasIds: [butter.aliasId] });

      const [change] = await listAIChanges();

      await undoAIChange(actor, change!.id);
      expect(await lineFoods(line.id)).toMatchObject({
        aliasIds: [butter.aliasId, melted.aliasId],
      });
    });

    it("deletes a food AI is not sure is not a food, as it does when sure", async () => {
      const melted = await flagged("melted");

      readsNoFood(false);
      await expect(askAIAbout(melted.ingredientId)).resolves.toMatchObject({
        outcome: "not-a-food",
      });
      expect(resolutionRequests()).toBe(1);
      expect(await exists(melted.ingredientId)).toBe(false);
      expect(await listAIChanges()).toMatchObject([{ undo: { kind: "not-a-food" } }]);
    });

    it("keeps a food a Pantry Ingredient names, flagged, sure or not that it is not a food", async () => {
      for (const [text, sure] of [
        ["deegroller", true],
        ["taartvorm", false],
      ] as const) {
        const food = await unnamed(text);

        await nameEverywhere(food, text);
        readsNoFood(sure);

        await expect(askAIAbout(food.ingredientId)).resolves.toMatchObject({
          outcome: "unsure",
          reason: "ai-junk",
        });
        await expect(ingredientFor(food.aliasId)).resolves.toMatchObject({
          flagged: true,
          flagReason: "ai-junk",
        });
        await expect(
          getTestDb()
            .select({ id: recipeIngredients.id })
            .from(recipeIngredients)
            .where(inArray(recipeIngredients.name, [text]))
        ).resolves.toHaveLength(1);
      }
      expect(await listAIChanges()).toEqual([]);
    });
  });
});
