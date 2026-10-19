// @vitest-environment node
/**
 * Asking AI about an Ingredient after the fact, against a real database: AI's
 * answer is made, sure or not, and recorded as an AI Change; an unsure one
 * flags its food. The food itself is never its own candidate, and a food a
 * person decided about, or a seeded one, is never asked about. The Decision
 * is mocked at `decide` and the language model at `generateStructured`, as in
 * rung 3's tests.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionQuestions } from "@norish/shared-server/ai/runtime/runtime";
import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { listAIChanges } from "@norish/db/repositories/ingredient-ai-changes";
import { findIngredientAncestors } from "@norish/db/repositories/ingredient-relocation";
import { ingredients } from "@norish/db/schema";
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

import { getTestDb } from "../../../db/__tests__/helpers/db-test-helpers";
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
function compares(verdict: "same" | "kind-of" | "new", food: number | null, sure: boolean) {
  answers("ingredient-resolution", { verdict, food, sure, englishName: null });
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
      food: change.ingredient.name,
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
});
