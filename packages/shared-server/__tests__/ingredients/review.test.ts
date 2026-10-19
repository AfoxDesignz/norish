// @vitest-environment node
/**
 * Asking AI about an Ingredient after the fact, against a real database: AI's
 * answer is made, sure or not, and recorded as an AI Change; an unsure one
 * flags its food. The food itself is never its own candidate, and a food a
 * person decided about, or a seeded one, is never asked about. The Decision
 * is mocked at `decide` and the language model at `generateStructured`, as in
 * rung 3's tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionQuestions } from "@norish/shared-server/ai/runtime/runtime";
import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { listAIChanges } from "@norish/db/repositories/ingredient-ai-changes";
import { findIngredientAncestors } from "@norish/db/repositories/ingredient-relocation";
import { ingredients } from "@norish/db/schema";
import {
  decide,
  estimateDecisionInputTokens,
  estimateStructuredInputTokens,
  generateStructured,
} from "@norish/shared-server/ai/runtime/runtime";
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
import {
  askAIAbout,
  estimateReviewTokens,
  listReviewableIngredients,
  withoutSettled,
} from "@norish/shared-server/ingredients/review";

import { createTestUser, getTestDb } from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";

vi.mock("@norish/shared-server/ai/runtime/runtime", () => ({
  decide: vi.fn(),
  generateStructured: vi.fn(),
  estimateStructuredInputTokens: vi.fn(),
  estimateDecisionInputTokens: vi.fn(),
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

    await expect(askAIAbout(actor, bulbs.ingredientId)).resolves.toMatchObject({
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

    await expect(askAIAbout(actor, rings.ingredientId)).resolves.toMatchObject({
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

    await expect(askAIAbout(actor, red.ingredientId)).resolves.toMatchObject({
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

    await expect(askAIAbout(actor, red.ingredientId)).resolves.toMatchObject({
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

    await expect(askAIAbout(actor, spring.ingredientId)).resolves.toMatchObject({
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

    await expect(askAIAbout(actor, thing.ingredientId)).resolves.toMatchObject({
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
    await askAIAbout(actor, red.ingredientId);
    vi.mocked(decide).mockRejectedValue(new Error("Decision Model unreachable"));
    answers("ingredient-resolution", new Error("model unreachable"));
    answers("ingredient-resolution", new Error("model unreachable"));

    await expect(askAIAbout(actor, red.ingredientId)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "ai-unavailable",
    });
    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({
      flagReason: "ai-unavailable",
    });
    expect(await changes()).toMatchObject([{ kind: "parent", sure: false }]);
  });

  it("asks AI about a name no known food shares a word with, and follows the food it names", async () => {
    // "ui" shares no letters with "onion": rung 3 asked nothing and minted it flagged.
    const onion = await kept("onion");
    const ui = await flagged("ui");

    reads({ englishName: "onion", generalFood: null, sure: true });
    decides("Is onion", 0.95);

    await expect(askAIAbout(actor, ui.ingredientId)).resolves.toMatchObject({
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
    await expect(askAIAbout(actor, kipfilet.ingredientId)).resolves.toMatchObject({
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
    await expect(askAIAbout(actor, knaks.ingredientId)).resolves.toMatchObject({
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
      await expect(askAIAbout({ ...actor, isServerAdmin: true }, id)).resolves.toMatchObject({
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
    await askAIAbout(actor, bulbs.ingredientId);
    reads({ englishName: "red onion", generalFood: "onion", sure: true });
    decides("Is a kind of onion", 0.95);
    await askAIAbout(actor, red.ingredientId);
    for (const change of await listAIChanges()) await undoAIChange(actor, change.id);

    const restored = (await ingredientFor(bulbs.aliasId))!;

    reads({ englishName: "onion", generalFood: null, sure: true });
    decides("Is onion", 0.95);
    await expect(askAIAbout(actor, restored.id)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "undone",
    });
    reads({ englishName: "red onion", generalFood: "onion", sure: true });
    decides("Is a kind of onion", 0.95);
    await expect(askAIAbout(actor, red.ingredientId)).resolves.toMatchObject({
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
    await askAIAbout(actor, red.ingredientId);
    await keepAIChange(actor, (await listAIChanges())[0]!.id);

    await expect(ingredientFor(red.aliasId)).resolves.toMatchObject({ flagged: false });
    await expect(askAIAbout(actor, red.ingredientId)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "decided",
    });
    expect(await changes()).toMatchObject([{ kind: "parent", kept: true }]);
  });

  it("follows the edit policy", async () => {
    const onion = await flagged("onion");
    const stranger = await createTestUser();

    await expect(
      askAIAbout(
        { userId: stranger.id, householdUserIds: null, isServerAdmin: false },
        onion.ingredientId
      )
    ).rejects.toMatchObject({ refusal: "forbidden" });
  });
});

describe("what a round of Ask AI picks from", () => {
  const testBase = new RepositoryTestBase("test_ingredient_review_scope");

  let actor: CatalogueActor;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    actor = { userId: user.id, householdUserIds: null, isServerAdmin: false };
    vi.mocked(isAIEnabled).mockResolvedValue(false);
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(true);
    vi.mocked(estimateStructuredInputTokens)
      .mockReset()
      .mockResolvedValue({ provider: "openai", model: "gpt-5.6-luna", tokens: 700 });
    vi.mocked(estimateDecisionInputTokens)
      .mockReset()
      .mockResolvedValue({ provider: "typesafe", model: "jev-latest", tokens: 500 });
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  /** A food minted while AI was off, flagged, as `owner`'s. */
  async function flaggedAs(text: string, owner: string | null = actor.userId) {
    const [resolved] = await resolveIngredients([text], { userId: owner });

    return resolved!.ingredientId;
  }

  it("lists the flagged foods AI may ask about that the asker may edit, by name", async () => {
    const bulbs = await flaggedAs("onion bulbs");
    const uien = await flaggedAs("uien");
    const knaks = await flaggedAs("Unox Knaks");
    const settled = await flaggedAs("shallot");
    const nobodys = await flaggedAs("anna avondeten", null);
    const strangers = await flaggedAs("bosuitjes", (await createTestUser()).id);

    await markDistinct(actor, settled);

    const listed = await listReviewableIngredients(actor);

    expect(listed.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: bulbs, name: "onion bulbs" },
      { id: uien, name: "uien" },
      { id: knaks, name: "Unox Knaks" },
    ]);
    // A server admin may edit every food, the ones nobody owns included.
    expect(
      (await listReviewableIngredients({ ...actor, isServerAdmin: true })).map((food) => food.id)
    ).toEqual(expect.arrayContaining([nobodys, strangers]));
  });

  it("estimates a food's question from what would be sent, each request in full, with nothing asked", async () => {
    await flaggedAs("onion");

    // "onion bulbs" shares a word with onion: read, compare, and a Decision.
    // "Unox Knaks" shares none: read and compare, with no Decision to ask.
    const perModel = await estimateReviewTokens(["onion bulbs", "Unox Knaks"]);

    // Each request with its 50-token answer, averaged over the two names.
    expect(perModel).toEqual([
      { provider: "openai", model: "gpt-5.6-luna", perFood: 750 + 750 },
      { provider: "typesafe", model: "jev-latest", perFood: (500 + 50) / 2 },
    ]);
    const comparing = vi
      .mocked(estimateStructuredInputTokens)
      .mock.calls.map(([options]) => options.sections?.join("\n") ?? "")
      .filter((text) => text.includes("Foods in the catalogue"));

    expect(comparing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("1. onion"),
        expect.stringContaining("none share a word"),
      ])
    );
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
    expect(vi.mocked(decide)).not.toHaveBeenCalled();
  });

  it("leaves out the Decision where none is in use, and reads a few names spread over the round", async () => {
    vi.mocked(isDecisionUseEnabled).mockResolvedValue(false);
    const names = Array.from({ length: 20 }, (_, index) => `food ${index}`);

    await expect(estimateReviewTokens(names)).resolves.toEqual([
      { provider: "openai", model: "gpt-5.6-luna", perFood: 700 + 50 + 700 + 50 },
    ]);

    // Two requests a name, for five names spread over the twenty.
    const read = vi
      .mocked(estimateStructuredInputTokens)
      .mock.calls.map(([options]) => options.sections?.[0]);

    expect(new Set(read)).toEqual(
      new Set([
        "New name: food 0",
        "New name: food 4",
        "New name: food 8",
        "New name: food 12",
        "New name: food 16",
      ])
    );
    expect(vi.mocked(estimateDecisionInputTokens)).not.toHaveBeenCalled();
  });

  it("estimates nothing for a round with no foods", async () => {
    await expect(estimateReviewTokens([])).resolves.toEqual([]);
  });

  it("lists in a finished round's report only the foods still open since", async () => {
    const knaks = await flaggedAs("Unox Knaks");
    const settled = await flaggedAs("shallot");
    const gone = crypto.randomUUID();
    const unsure = (ingredientId: string) => ({
      ingredientId,
      outcome: "unsure" as const,
      reason: "ai-unsure",
      considered: [],
      englishName: null,
    });
    const merged = {
      ingredientId: settled,
      outcome: "merge" as const,
      into: "onion",
      considered: [],
      englishName: null,
    };
    const report = {
      jobId: "round-1",
      finished: true,
      entries: [unsure(knaks), unsure(settled), unsure(gone), merged],
      waiting: [],
    };

    await markDistinct(actor, settled);

    // Still flagged stays; kept distinct since, or gone, drops; a change's entry is not the filter's.
    expect((await withoutSettled(report)).entries).toEqual([unsure(knaks), merged]);
    // A round still running is shown as it is.
    expect((await withoutSettled({ ...report, finished: false })).entries).toHaveLength(4);
    // Asked what it is a kind of, a food is open while it has no parent, flagged or not.
    const parents = report.entries.map((entry) => ({ ...entry, mode: "parent" as const }));

    expect(
      (await withoutSettled({ ...report, entries: parents })).entries.map((it) => it.ingredientId)
    ).toEqual([knaks, settled, settled]);
  });
});
