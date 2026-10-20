// @vitest-environment node
/**
 * Rung 3 of the ingredient resolver against a real database: a text no alias
 * matches is asked about before anything is minted. The Decision is mocked at
 * `decide`, the one AI seam, and the language-model fallback at the runtime's
 * `generateStructured`; the configuration says whether either may be asked.
 */
import { APICallError } from "ai";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeedEntry } from "@norish/db/repositories/ingredient-seed";
import type { DecisionQuestions } from "@norish/shared-server/ai/runtime/runtime";
import { createRecipeWithRefs, getRecipeFull } from "@norish/db";
import { withTransaction } from "@norish/db/drizzle";
import { listAIChanges } from "@norish/db/repositories/ingredient-ai-changes";
import { deleteCatalogueIngredient } from "@norish/db/repositories/ingredient-catalogue";
import {
  findIngredientAncestors,
  mergeCatalogueIngredients,
} from "@norish/db/repositories/ingredient-relocation";
import {
  applyIngredientSeed,
  listSeededIngredientIds,
} from "@norish/db/repositories/ingredient-seed";
import { ingredientAliases, ingredients } from "@norish/db/schema";
import {
  RESOLUTION_BUDGET_MS,
  RESOLUTION_THRESHOLD,
} from "@norish/shared-server/ai/resolution/ingredient-resolution";
import { AIProviderError } from "@norish/shared-server/ai/runtime/errors";
import { decide, generateStructured } from "@norish/shared-server/ai/runtime/runtime";
import {
  isAIEnabled,
  isDecisionUseEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { undoAIChange } from "@norish/shared-server/ingredients/ai-changes";
import { resolveGroceryNames } from "@norish/shared-server/ingredients/groceries";
import {
  updateResolvedRecipe,
  withResolvedIngredients,
} from "@norish/shared-server/ingredients/recipe-lines";
import {
  ingredientFor,
  resolveIngredient,
  resolveIngredients,
} from "@norish/shared-server/ingredients/resolver";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import { getSpellingTexts, getTestDb } from "../../../db/__tests__/helpers/db-test-helpers";
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

/**
 * A Decision that picks the option whose description is `pick` with
 * probability `p`, the rest of the mass on the other options. `meanwhile`
 * runs while the Decision is thinking.
 */
function decides(pick: string, p: number, meanwhile?: () => Promise<unknown>) {
  vi.mocked(decide).mockImplementationOnce((async ({
    questions,
  }: {
    questions: DecisionQuestions;
  }) => {
    await meanwhile?.();
    const [id, question] = Object.entries(questions)[0]!;

    if (question.type !== "choice") throw new Error("expected a choice");

    const labels = Object.keys(question.criteria);
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

/** What the language model answers about the numbered known foods. */
function answers(answer: {
  verdict: "same" | "kind-of" | "new";
  food: number | null;
  sure: boolean;
}) {
  vi.mocked(generateStructured).mockResolvedValueOnce(answer);
}

/** The language model's answer naming a listed food by name, whatever its number. */
function answersAbout(name: string, verdict: "same" | "kind-of", sure: boolean) {
  vi.mocked(generateStructured).mockImplementationOnce((async ({
    sections,
  }: {
    sections: string[];
  }) => {
    const line = sections
      .join("\n")
      .split("\n")
      .find((row) => /^\d+\. /.test(row) && row.slice(row.indexOf(" ") + 1).startsWith(name));

    if (!line) throw new Error(`no listed food reads "${name}": ${sections.join(" | ")}`);

    return { verdict, food: Number(line.split(".")[0]), sure, englishName: null };
  }) as never);
}

function entry(offId: string, ...names: string[]): SeedEntry {
  return {
    offId,
    name: names[0]!,
    nameFold: ingredientAliasFold(names[0]!),
    parentOffId: null,
    nutrition: null,
    aliases: names.map((text) => ({ text, fold: ingredientAliasFold(text), locale: null })),
  };
}

describe("ingredient resolver, rung 3", () => {
  const testBase = new RepositoryTestBase("test_ingredient_resolver_ai");

  let userId: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;
    vi.mocked(decide).mockReset();
    vi.mocked(generateStructured).mockReset();
    vi.mocked(isAIEnabled).mockResolvedValue(true);
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(true);
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  async function resolveOne(text: string) {
    const [resolved] = await resolveIngredients([text], { userId });

    return resolved!;
  }

  /** A food Norish already knows, minted while nothing could be asked. */
  async function known(text: string) {
    vi.mocked(isAIEnabled).mockResolvedValueOnce(false);

    return resolveOne(text);
  }

  it("mints a flagged food where the food a sure answer named was merged away meanwhile", async () => {
    const onion = await known("onion");
    const shallot = await known("shallot");

    decides("Is onion", 0.95, () =>
      withTransaction((tx) =>
        mergeCatalogueIngredients(tx, onion.ingredientId, shallot.ingredientId)
      )
    );

    const ui = await resolveOne("ui");

    expect(ui.ingredientId).not.toBe(onion.ingredientId);
    await expect(ingredientFor(ui.aliasId)).resolves.toMatchObject({
      name: "ui",
      flagged: true,
    });
  });

  it("files a text a sure Decision names as a known food under that food", async () => {
    const onion = await known("onion");

    decides("Is onion", 0.95);
    const bulbs = await resolveOne("onion bulbs");

    expect(bulbs.ingredientId).toBe(onion.ingredientId);
    expect(vi.mocked(isDecisionUseEnabled)).toHaveBeenCalledWith("ingredientResolution");

    // Now a spelling of onion: the next one matches exactly, and nothing is asked.
    await expect(resolveOne("Onion Bulbs")).resolves.toMatchObject({
      ingredientId: onion.ingredientId,
    });
    expect(vi.mocked(decide)).toHaveBeenCalledTimes(1);
  });

  it("gives a known food only the clean spelling of a text AI joined to it", async () => {
    const onion = await known("onion");

    decides("Is onion", 0.95);
    await expect(resolveOne("2 onion bulbs (diced)")).resolves.toMatchObject({
      ingredientId: onion.ingredientId,
    });

    await expect(getSpellingTexts(onion.ingredientId)).resolves.toEqual(["onion", "onion bulbs"]);
  });

  it("keeps the foods of a saved recipe's unchanged lines, and resolves only the edited one", async () => {
    const shallot = await known("shallot");
    const carrot = await known("carrot");
    const tomato = await known("tomato");
    await known("onion");
    await known("leek");
    const recipeId = crypto.randomUUID();
    const lines = [
      // An import named the food; the line's own text would need AI to connect.
      {
        ingredientId: null,
        ingredientName: "onion bulbs, chopped",
        foodTexts: ["shallot"],
        amount: 2,
        unit: null,
        order: 0,
      },
      { ingredientId: null, ingredientName: "leek", amount: 1, unit: null, order: 1 },
      {
        ingredientId: null,
        ingredientName: "GR CHERRYTOMATEN",
        foodTexts: ["tomato"],
        amount: 150,
        unit: null,
        order: 2,
      },
    ];

    await createRecipeWithRefs(
      recipeId,
      userId,
      await withResolvedIngredients(
        { name: "Soup", systemUsed: "metric", recipeIngredients: lines },
        { userId }
      )
    );
    const [kept, edited, reparsed] = (await getRecipeFull(recipeId))!.recipeIngredients;

    await updateResolvedRecipe(
      recipeId,
      userId,
      {
        systemUsed: "metric",
        recipeIngredients: [
          { id: kept!.id, ingredientName: "onion bulbs, chopped", amount: 2, unit: null, order: 0 },
          { id: edited!.id, ingredientName: "carrots", amount: 1, unit: null, order: 1 },
          // The editor shows "150 GR CHERRYTOMATEN" and parses it back with the unit apart.
          { id: reparsed!.id, ingredientName: "CHERRYTOMATEN", amount: 150, unit: "GR", order: 2 },
        ],
      },
      { userId }
    );

    expect((await getRecipeFull(recipeId))?.recipeIngredients).toMatchObject([
      { id: kept!.id, ingredientId: shallot.ingredientId },
      { id: edited!.id, ingredientId: carrot.ingredientId },
      { id: reparsed!.id, ingredientId: tomato.ingredientId },
    ]);
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
  });

  it("keeps a saved line whose food was deleted without one, rather than asking about it again", async () => {
    const roller = await known("deegroller");
    await known("flour");
    const recipeId = crypto.randomUUID();

    await createRecipeWithRefs(
      recipeId,
      userId,
      await withResolvedIngredients(
        {
          name: "Pie",
          systemUsed: "metric",
          recipeIngredients: [
            {
              ingredientId: null,
              ingredientName: "deegroller",
              amount: null,
              unit: null,
              order: 0,
            },
            { ingredientId: null, ingredientName: "flour", amount: 200, unit: "g", order: 1 },
          ],
        },
        { userId }
      )
    );
    await withTransaction((tx) => deleteCatalogueIngredient(tx, roller.ingredientId));
    const [tool, flour] = (await getRecipeFull(recipeId))!.recipeIngredients;

    await updateResolvedRecipe(
      recipeId,
      userId,
      {
        systemUsed: "metric",
        recipeIngredients: [
          { id: tool!.id, ingredientName: "deegroller", amount: null, unit: null, order: 0 },
          { id: flour!.id, ingredientName: "flour", amount: 250, unit: "g", order: 1 },
        ],
      },
      { userId }
    );

    expect((await getRecipeFull(recipeId))?.recipeIngredients).toMatchObject([
      { id: tool!.id, ingredientName: "deegroller", ingredientId: null },
      { id: flour!.id, ingredientId: flour!.ingredientId },
    ]);
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
  });

  it("acts on a Decision exactly at the threshold, and asks the language model just below it", async () => {
    const tomato = await known("tomato");

    decides("Is tomato", RESOLUTION_THRESHOLD);
    await expect(resolveOne("tomaat")).resolves.toMatchObject({
      ingredientId: tomato.ingredientId,
    });
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();

    decides("Is tomato", RESOLUTION_THRESHOLD - 0.01);
    answers({ verdict: "new", food: null, sure: false });
    const paste = await resolveOne("tomato paste");

    expect(vi.mocked(generateStructured)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "ingredient-resolution" })
    );
    expect(paste.ingredientId).not.toBe(tomato.ingredientId);
  });

  it("mints a new food, unflagged, where the Decision is sure it is one", async () => {
    await known("onion");

    decides("Is none of these, but a food of its own", 0.9);
    const powder = await resolveOne("onion powder");

    await expect(ingredientFor(powder.aliasId)).resolves.toMatchObject({
      name: "onion powder",
      flagged: false,
    });
  });

  it("places a sure kind-of answer under the food it is a kind of", async () => {
    const onion = await known("onion");

    decides("Is a kind of onion", 0.9);
    const red = await resolveOne("red onion");

    expect(red.ingredientId).not.toBe(onion.ingredientId);
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagged: false });
    await expect(findIngredientAncestors([red.ingredientId])).resolves.toEqual(
      new Map([[red.ingredientId, [onion.ingredientId]]])
    );
  });

  it("places an unsure kind-of answer under the food too, flagged with the change to keep or undo", async () => {
    const onion = await known("onion");

    vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
    answers({ verdict: "kind-of", food: 1, sure: false });
    const red = await resolveOne("red onion");

    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagged: true });
    await expect(findIngredientAncestors([red.ingredientId])).resolves.toEqual(
      new Map([[red.ingredientId, [onion.ingredientId]]])
    );
    const [change, ...others] = await listAIChanges();

    expect(others).toEqual([]);
    // AI's guess, not one from the words of the name.
    expect(change).toMatchObject({
      sure: false,
      ingredient: { id: red.ingredientId },
      target: { id: onion.ingredientId },
      undo: { kind: "parent", formerParentId: null },
    });
    expect(change!.undo).not.toHaveProperty("fromWords", true);

    await undoAIChange({ userId, householdUserIds: null, isServerAdmin: false }, change!.id);
    await expect(findIngredientAncestors([red.ingredientId])).resolves.toEqual(
      new Map([[red.ingredientId, []]])
    );
  });

  it("mints a kind of a food merged away meanwhile with no parent", async () => {
    const onion = await known("onion");
    const shallot = await known("shallot");

    decides("Is a kind of onion", 0.9, () =>
      withTransaction((tx) =>
        mergeCatalogueIngredients(tx, onion.ingredientId, shallot.ingredientId)
      )
    );
    const red = await resolveOne("red onion");

    await expect(findIngredientAncestors([red.ingredientId])).resolves.toEqual(
      new Map([[red.ingredientId, []]])
    );
  });

  it("follows a sure language-model answer when the Decision is unsure", async () => {
    const milk = await known("milk");

    decides("Is milk", 0.4);
    answers({ verdict: "same", food: 1, sure: true });

    await expect(resolveOne("whole milk")).resolves.toMatchObject({
      ingredientId: milk.ingredientId,
    });
  });

  it("joins a text an unsure answer names to that food, as an unsure AI Change Undo takes back", async () => {
    const milk = await known("milk");

    decides("Is milk", 0.4);
    answers({ verdict: "same", food: 1, sure: false });
    const oat = await resolveOne("oat milk");

    expect(oat.ingredientId).toBe(milk.ingredientId);
    await expect(ingredientFor(oat.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-unsure",
    });
    const [change, ...others] = await listAIChanges();

    expect(others).toEqual([]);
    expect(change).toMatchObject({
      sure: false,
      ingredient: { id: milk.ingredientId },
      undo: { kind: "merge", name: "oat milk", ownerId: userId, aliasIds: [oat.aliasId] },
    });

    await undoAIChange({ userId, householdUserIds: null, isServerAdmin: false }, change!.id);
    const own = await ingredientFor(oat.aliasId);

    expect(own).toMatchObject({ name: "oat milk" });
    expect(own!.id).not.toBe(milk.ingredientId);
  });

  it("asks the language model when the Decision fails", async () => {
    const leek = await known("leek");

    vi.mocked(decide).mockRejectedValueOnce(new Error("Decision Model unreachable"));
    answers({ verdict: "same", food: 1, sure: true });

    await expect(resolveOne("leeks")).resolves.toMatchObject({ ingredientId: leek.ingredientId });
  });

  it("asks the language model alone when the Decision Model is not in use", async () => {
    const leek = await known("leek");

    vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
    answers({ verdict: "same", food: 1, sure: true });

    await expect(resolveOne("leeks")).resolves.toMatchObject({ ingredientId: leek.ingredientId });
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
  });

  it("mints a flagged food, and never fails, when every AI step fails", async () => {
    await known("garlic");

    vi.mocked(decide).mockRejectedValueOnce(new Error("Decision Model unreachable"));
    vi.mocked(generateStructured).mockRejectedValueOnce(new Error("model unreachable"));
    const cloves = await resolveOne("garlic cloves");

    await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({ flagged: true });
  });

  it("says the key was refused when the provider refused it", async () => {
    await known("garlic");

    const refused = new AIProviderError("The AI provider rejected the configured API key.", {
      retryable: false,
      cause: new APICallError({
        message: "Incorrect API key provided",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 401,
      }),
    });

    vi.mocked(decide).mockRejectedValueOnce(refused);
    vi.mocked(generateStructured).mockRejectedValueOnce(refused);
    const cloves = await resolveOne("garlic cloves");

    await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-key-rejected",
    });
  });

  it("asks nothing without AI, and flags what it mints", async () => {
    await known("garlic");

    vi.mocked(isAIEnabled).mockResolvedValue(false);
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
    const cloves = await resolveOne("garlic cloves");

    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
    await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "ai-off",
    });
  });

  it("asks nothing for a text that shares no word with any known food, and flags it", async () => {
    await known("onion");

    // Could be a translation nothing here can see ("ui"): a person's to judge.
    const ui = await resolveOne("ui");

    expect(vi.mocked(decide)).not.toHaveBeenCalled();
    await expect(ingredientFor(ui.aliasId)).resolves.toMatchObject({
      flagged: true,
      flagReason: "unknown-food",
    });
  });

  describe("a slip of the fingers", () => {
    it("takes the known food a text is a slip of, anywhere in its name, where AI gives no answer", async () => {
      const parmesan = await known("parmezaan");

      vi.mocked(isAIEnabled).mockResolvedValue(false);
      const [late, early] = await resolveIngredients(["parmezan", "barmezaan"], { userId });

      expect(late).toMatchObject({ ingredientId: parmesan.ingredientId });
      expect(early).toMatchObject({ ingredientId: parmesan.ingredientId });
      // The slip joins as a spelling of its own, which a person can move where it is wrong.
      expect(late!.aliasId).not.toBe(parmesan.aliasId);

      vi.mocked(isAIEnabled).mockResolvedValue(true);
      vi.mocked(generateStructured).mockRejectedValue(new Error("provider down"));
      expect((await resolveOne("parmezaam")).ingredientId).toBe(parmesan.ingredientId);
    });

    it("takes no slip under five letters, nor one two foods are equally near", async () => {
      const meel = await known("meel");
      const [sherry, cherry] = await resolveIngredients(
        ["sherry", "cherry"],
        { userId },
        { ai: false }
      );

      vi.mocked(isAIEnabled).mockResolvedValue(false);
      const [melk, xherry] = await resolveIngredients(["melk", "xherry"], { userId });

      expect(melk!.ingredientId).not.toBe(meel.ingredientId);
      expect([sherry!.ingredientId, cherry!.ingredientId]).not.toContain(xherry!.ingredientId);
    });

    it("puts the food a text is a slip of before AI, which decides, where AI is on", async () => {
      const parmesan = await known("parmezaan");
      const sherry = await known("sherry");

      // No word of either is the start of a word of a known food: only the slip finds one.
      answersAbout("parmezaan", "same", true);
      expect((await resolveOne("barmezaan")).ingredientId).toBe(parmesan.ingredientId);

      answers({ verdict: "new", food: null, sure: true });
      const cherry = await resolveOne("cherry");

      expect(cherry.ingredientId).not.toBe(sherry.ingredientId);
      expect(vi.mocked(generateStructured).mock.calls[1]![0].sections.join("\n")).toContain(
        "sherry"
      );
    });
  });

  it("mints a flagged food rather than wait past the budget on AI", async () => {
    await known("garlic");
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      vi.mocked(decide).mockReturnValueOnce(new Promise(() => undefined));
      const pending = resolveOne("garlic cloves");

      await vi.waitFor(() => expect(vi.mocked(decide)).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(RESOLUTION_BUDGET_MS);
      const cloves = await pending;

      await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({ flagged: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds the food a name is about even where a common word fills the catalogue", async () => {
    const onion = await known("onion");
    // More foods starting "red" than one search reads.
    const reds = await getTestDb()
      .insert(ingredients)
      .values(Array.from({ length: 450 }, (_, index) => ({ name: `red thing ${index}` })))
      .returning({ id: ingredients.id, name: ingredients.name });

    await getTestDb()
      .insert(ingredientAliases)
      .values(reds.map((row) => ({ text: row.name, fold: row.name, ingredientId: row.id })));

    decides("Is onion", 0.95);

    await expect(resolveOne("red onions")).resolves.toMatchObject({
      ingredientId: onion.ingredientId,
    });
  });

  describe("weighed against the words of the name", () => {
    let seeded: Map<string, string>;

    beforeEach(async () => {
      // "garlic cloves crushed" points at garlic by its words; "clov" also finds the spice.
      await applyIngredientSeed([entry("en:garlic", "garlic"), entry("en:clove", "clove")]);
      seeded = await listSeededIngredientIds();
    });

    async function parentOf(ingredientId: string) {
      return (await findIngredientAncestors([ingredientId])).get(ingredientId)?.[0] ?? null;
    }

    it("takes an unsure answer that agrees with the words as sure: filed, unflagged, no question", async () => {
      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      answersAbout("garlic", "kind-of", false);
      const cloves = await resolveOne("garlic cloves crushed");

      await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({
        name: "garlic cloves",
        flagged: false,
      });
      expect(await parentOf(cloves.ingredientId)).toBe(seeded.get("en:garlic"));
      expect(await listAIChanges()).toHaveLength(0);
    });

    it("lets the Decision settle the language model against the words, either way", async () => {
      decides("Is a kind of garlic", 0.4);
      answersAbout("clove", "kind-of", true);
      decides("Is a kind of garlic", 0.9);
      const cloves = await resolveOne("garlic cloves crushed");

      await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({ flagged: false });
      expect(await parentOf(cloves.ingredientId)).toBe(seeded.get("en:garlic"));

      decides("Is a kind of garlic", 0.4);
      answersAbout("clove", "kind-of", true);
      decides("Is a kind of clove", 0.9);
      const sliced = await resolveOne("garlic bulb cloves");

      expect(sliced.ingredientId).not.toBe(cloves.ingredientId);
      expect(await parentOf(sliced.ingredientId)).toBe(seeded.get("en:clove"));
      expect(vi.mocked(decide)).toHaveBeenCalledTimes(4);
    });

    it("keeps the language model's answer where the Decision cannot settle it, or there is none", async () => {
      decides("Is a kind of garlic", 0.4);
      answersAbout("clove", "kind-of", true);
      decides("Is a kind of garlic", 0.6);
      const undecided = await resolveOne("garlic cloves crushed");

      expect(await parentOf(undecided.ingredientId)).toBe(seeded.get("en:clove"));

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      answersAbout("clove", "kind-of", true);
      const alone = await resolveOne("garlic bulb cloves");

      expect(await parentOf(alone.ingredientId)).toBe(seeded.get("en:clove"));
      await expect(ingredientFor(alone.aliasId)).resolves.toMatchObject({ flagged: false });
    });

    it("falls back to the words, with a question for a person, where AI is unsure and names nothing", async () => {
      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
      answers({ verdict: "new", food: null, sure: false });
      const cloves = await resolveOne("garlic cloves crushed");

      await expect(ingredientFor(cloves.aliasId)).resolves.toMatchObject({
        flagged: true,
        flagReason: "ai-unsure",
      });
      expect(await parentOf(cloves.ingredientId)).toBe(seeded.get("en:garlic"));
      expect(await listAIChanges()).toMatchObject([
        { sure: false, undo: { kind: "parent", fromWords: true } },
      ]);
    });
  });

  it("asks once for texts in one call that resolve alike", async () => {
    const onion = await known("onion");

    decides("Is onion", 0.95);
    const [diced, bare] = await resolveIngredients(["onion bulbs, diced", "onion bulbs (2)"], {
      userId,
    });

    expect(diced!.ingredientId).toBe(onion.ingredientId);
    expect(bare!.ingredientId).toBe(onion.ingredientId);
    expect(vi.mocked(decide)).toHaveBeenCalledTimes(1);
  });

  describe("several foods, and not a food", () => {
    const actor = () => ({ userId, householdUserIds: null, isServerAdmin: false });

    beforeEach(() => {
      vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
    });

    /**
     * The language model's answer per name it is asked about, whatever order the questions come
     * in. `about` names the listed food a same or kind-of answer gives the number of.
     */
    function answering(
      byName: Record<
        string,
        {
          verdict: "same" | "kind-of" | "new" | "several" | "not-a-food";
          about?: string;
          sure: boolean;
          parts?: string[];
          joined?: "together" | "alternatives";
        }
      >
    ) {
      vi.mocked(generateStructured).mockImplementation((async ({
        sections,
      }: {
        sections: string[];
      }) => {
        const text = sections.join("\n");
        const name = /^New name: (.*)$/m.exec(text)?.[1] ?? "";
        const answer = byName[name];

        if (!answer) throw new Error(`no answer for "${name}"`);
        const listed = answer.about
          ? text
              .split("\n")
              .find(
                (row) =>
                  /^\d+\. /.test(row) && row.slice(row.indexOf(" ") + 1).startsWith(answer.about!)
              )
          : undefined;

        return {
          verdict: answer.verdict,
          food: listed ? Number(listed.split(".")[0]) : null,
          sure: answer.sure,
          parts: answer.parts ?? null,
          joined: answer.joined ?? null,
          englishName: null,
        };
      }) as never);
    }

    async function saved(name: string, texts: string[], recipeId = crypto.randomUUID()) {
      await createRecipeWithRefs(
        recipeId,
        userId,
        await withResolvedIngredients(
          {
            name,
            systemUsed: "metric",
            recipeIngredients: texts.map((ingredientName, order) => ({
              ingredientId: null,
              ingredientName,
              amount: null,
              unit: null,
              order,
            })),
          },
          { userId }
        )
      );

      return { recipeId, lines: (await getRecipeFull(recipeId))!.recipeIngredients };
    }

    it("splits a name AI is sure names several foods into each, as alternatives", async () => {
      const mustard = await known("mustard");

      answering({
        "Dijon or yellow mustard": {
          verdict: "several",
          sure: true,
          parts: ["Dijon mustard", "yellow mustard"],
          joined: "alternatives",
        },
        "Dijon mustard": { verdict: "kind-of", about: "mustard", sure: true },
        "yellow mustard": { verdict: "same", about: "mustard", sure: true },
      });
      const { lines } = await saved("Hot dogs", ["Dijon or yellow mustard"]);
      const dijon = await resolveIngredient("Dijon mustard", { userId }, { ai: false });

      expect(lines).toMatchObject([
        {
          ingredientName: "Dijon or yellow mustard",
          joined: "alternatives",
          foods: [{ ingredientId: dijon!.ingredientId }, { ingredientId: mustard.ingredientId }],
        },
      ]);
      expect(await findIngredientAncestors([dijon!.ingredientId])).toEqual(
        new Map([[dijon!.ingredientId, [mustard.ingredientId]]])
      );
      // The joined name is no food of its own.
      await expect(
        getTestDb()
          .select()
          .from(ingredients)
          .where(eq(ingredients.name, "Dijon or yellow mustard"))
      ).resolves.toEqual([]);
    });

    it("keeps a name AI is not sure names several as one food, flagged", async () => {
      await known("mustard");
      answering({
        "Dijon or yellow mustard": {
          verdict: "several",
          sure: false,
          parts: ["Dijon mustard", "yellow mustard"],
          joined: "alternatives",
        },
      });
      const { lines } = await saved("Hot dogs", ["Dijon or yellow mustard"]);
      const [line] = lines;

      expect(line).toMatchObject({ joined: null });
      await expect(
        getTestDb().select().from(ingredients).where(eq(ingredients.id, line!.ingredientId!))
      ).resolves.toMatchObject([
        { name: "Dijon or yellow mustard", flagged: true, flagReason: "ai-unsure" },
      ]);
    });

    it("keeps a line AI says is not a food in its recipe as written with no food, sure or not, minting nothing", async () => {
      await known("deeg");
      await known("snickers bars");
      // A food sharing the start of its word, so the import asks AI about it.
      await known("meltblokjes");
      answering({
        deegroller: { verdict: "not-a-food", sure: true },
        melted: { verdict: "not-a-food", sure: false },
      });
      const { lines } = await saved("snickers ice cream bars", [
        "snickers bars",
        "melted",
        "deegroller",
      ]);

      // No food: the add-to-groceries panel passes them over, as any line naming none.
      expect(lines).toMatchObject([
        { ingredientName: "snickers bars" },
        { ingredientName: "melted", ingredientId: null },
        { ingredientName: "deegroller", ingredientId: null },
      ]);
      await expect(getTestDb().select().from(ingredients)).resolves.toHaveLength(3);
      await expect(listAIChanges()).resolves.toEqual([]);
    });

    it("gives a typed text AI splits only its first food, minting none of the others", async () => {
      await known("mustard");
      answering({
        "Dijon or yellow mustard": {
          verdict: "several",
          sure: true,
          parts: ["Dijon mustard", "yellow mustard"],
          joined: "alternatives",
        },
        "Dijon mustard": { verdict: "new", sure: true },
      });

      const [typed] = await resolveGroceryNames([{ name: "Dijon or yellow mustard" }], { userId });

      await expect(ingredientFor(typed!.aliasId)).resolves.toMatchObject({ name: "Dijon mustard" });
      expect(
        (await getTestDb().select({ name: ingredients.name }).from(ingredients)).map(
          (row) => row.name
        )
      ).toEqual(expect.not.arrayContaining(["yellow mustard"]));
    });

    it("keeps a typed grocery AI says is not a food on the list with no food, minting nothing", async () => {
      // A food sharing the start of its word, so the import asks AI about it.
      await known("meltblokjes");
      answering({ melted: { verdict: "not-a-food", sure: true } });

      await expect(resolveGroceryNames([{ name: "melted" }], { userId })).resolves.toEqual([null]);
      await expect(getTestDb().select().from(ingredients)).resolves.toHaveLength(1);
      await expect(listAIChanges()).resolves.toEqual([]);
    });

    it("takes a Decision's sure not a food, and asks the language model for the parts of several", async () => {
      await known("deeg");
      const dijon = await known("Dijon mustard");
      const yellow = await known("yellow mustard");

      vi.mocked(isDecisionUseEnabled).mockResolvedValue(true);
      decides(
        "Is not a food: kitchen equipment the cook already has, a preparation, a fragment or a note",
        0.95
      );
      await expect(resolveIngredient("deegroller", { userId })).resolves.toBeNull();

      decides("Names several foods at once, joined by and or or", 0.95);
      answering({
        "Dijon or yellow mustard": {
          verdict: "several",
          sure: true,
          parts: ["Dijon mustard", "yellow mustard"],
          joined: "alternatives",
        },
      });
      const { lines } = await saved("Hot dogs", ["Dijon or yellow mustard"]);

      expect(lines).toMatchObject([
        {
          joined: "alternatives",
          foods: [{ ingredientId: dijon.ingredientId }, { ingredientId: yellow.ingredientId }],
        },
      ]);
      expect(vi.mocked(decide)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(generateStructured)).toHaveBeenCalledTimes(1);
    });
  });
});
