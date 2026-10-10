// @vitest-environment node
/**
 * Plain Names against a real database: a round's question leaves a rename
 * or a merge for a person, settles a name already plain, and a person's
 * answer settles the name for good; a new food is renamed at once, its flag
 * kept; and the recheck never renames a settled name from the words. The
 * language model is mocked at `generateStructured`.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { adoptPlainName } from "@norish/db/repositories/ingredient-seed";
import { listIngredientSuggestions } from "@norish/db/repositories/ingredient-suggestions";
import { ingredientAliases, ingredients } from "@norish/db/schema";
import { generateStructured } from "@norish/shared-server/ai/runtime/runtime";
import { isAIEnabled } from "@norish/shared-server/config/server-config-loader";
import { renameIngredient } from "@norish/shared-server/ingredients/catalogue";
import {
  cleanNameWithAI,
  giveNewIngredientItsPlainName,
  listNameableIngredients,
} from "@norish/shared-server/ingredients/plain-names";
import { resolveIngredients } from "@norish/shared-server/ingredients/resolver";
import {
  confirmSuggestion,
  dismissSuggestion,
} from "@norish/shared-server/ingredients/suggestions";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import { getTestDb } from "../../../db/__tests__/helpers/db-test-helpers";
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
}));

/** What the language model reads the next name as. */
function readsAs(plainName: string | null) {
  vi.mocked(generateStructured).mockResolvedValueOnce({ plainName });
}

describe("Plain Names", () => {
  const testBase = new RepositoryTestBase("test_ingredient_plain_names");

  let actor: CatalogueActor;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    actor = { userId: user.id, householdUserIds: null, isServerAdmin: false };
    vi.mocked(generateStructured).mockReset();
    // Foods are minted with AI off, flagged, as the upgrade leaves them.
    vi.mocked(isAIEnabled).mockResolvedValue(false);
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  async function food(text: string) {
    const [resolved] = await resolveIngredients([text], { userId: actor.userId });

    return resolved!.ingredientId;
  }

  async function row(id: string) {
    const [found] = await getTestDb()
      .select({
        name: ingredients.name,
        flagged: ingredients.flagged,
        nameSettled: ingredients.nameSettled,
      })
      .from(ingredients)
      .where(eq(ingredients.id, id));

    return found!;
  }

  async function spellings(id: string) {
    const rows = await getTestDb()
      .select({ text: ingredientAliases.text })
      .from(ingredientAliases)
      .where(eq(ingredientAliases.ingredientId, id));

    return rows.map((it) => it.text);
  }

  async function suggestionFor(id: string) {
    return (await listIngredientSuggestions()).find((it) => it.ingredientId === id) ?? null;
  }

  it("proposes the plain name, which a person taking renames the food, clears its flag and settles it", async () => {
    const tonijn = await food("Lekkerste Tonijn Uit Blik");

    readsAs("tonijn uit blik");
    await expect(cleanNameWithAI(actor, tonijn)).resolves.toEqual({
      outcome: "rename",
      to: "tonijn uit blik",
    });
    // Nothing changes until a person answers.
    expect(await row(tonijn)).toMatchObject({ flagged: true, nameSettled: false });
    // The question saw the food's other spellings too.
    expect(vi.mocked(generateStructured).mock.calls[0]![0].sections).toEqual([
      "Name: Lekkerste Tonijn Uit Blik",
    ]);

    const waiting = (await suggestionFor(tonijn))!;

    expect(waiting).toMatchObject({ kind: "rename", proposedName: "tonijn uit blik" });
    await confirmSuggestion(actor, waiting.id);

    expect(await row(tonijn)).toEqual({
      name: "tonijn uit blik",
      flagged: false,
      nameSettled: true,
    });
    expect(await suggestionFor(tonijn)).toBeNull();
    // The old name stays a spelling, so lines written so still find the food.
    expect(await spellings(tonijn)).toContain("Lekkerste Tonijn Uit Blik");
    expect((await listNameableIngredients(actor)).map((it) => it.id)).not.toContain(tonijn);
  });

  it("settles a name already plain, and a round asks about it no more", async () => {
    const thyme = await food("tijm");

    readsAs("tijm");
    await expect(cleanNameWithAI(actor, thyme)).resolves.toEqual({ outcome: "plain" });
    expect(await row(thyme)).toMatchObject({ nameSettled: true, flagged: true });
    expect(await suggestionFor(thyme)).toBeNull();
    // Settled since the round began: passed over.
    await expect(cleanNameWithAI(actor, thyme)).resolves.toEqual({
      outcome: "skipped",
      reason: "settled",
    });
  });

  it("proposes merging into the food that already spells the plain name, never merging itself", async () => {
    const onion = await food("onion");
    const messy = await food("Verse Onion Deluxe");

    readsAs("onion");
    await expect(cleanNameWithAI(actor, messy)).resolves.toMatchObject({
      outcome: "merge",
      into: "onion",
    });
    expect(await suggestionFor(messy)).toMatchObject({
      kind: "merge",
      target: { id: onion, name: "onion" },
      proposedName: "onion",
    });
    expect(await row(messy)).toMatchObject({ name: "Verse Onion Deluxe" });
  });

  it("remembers a name a person turned down", async () => {
    const knaks = await food("Unox Knaks Original");

    readsAs("Unox Knaks");
    await cleanNameWithAI(actor, knaks);
    await dismissSuggestion(actor, (await suggestionFor(knaks))!.id);

    expect(await row(knaks)).toMatchObject({ name: "Unox Knaks Original", nameSettled: true });
    expect((await listNameableIngredients(actor)).map((it) => it.id)).not.toContain(knaks);
  });

  it("proposes nothing for a name AI finds no food in", async () => {
    const junk = await food("zie stap 3");

    readsAs(null);
    await expect(cleanNameWithAI(actor, junk)).resolves.toMatchObject({
      outcome: "unsure",
      reason: "no-food",
    });
    expect(await suggestionFor(junk)).toBeNull();
    expect(await row(junk)).toMatchObject({ nameSettled: false });
  });

  it("asks about neither a seeded food nor one a suggestion waits on", async () => {
    const seeded = await food("salt");
    const tonijn = await food("Lekkerste Tonijn");
    const waiting = await food("Verse Kipfilet");

    await getTestDb()
      .update(ingredients)
      .set({ offId: "en:salt" })
      .where(eq(ingredients.id, seeded));
    readsAs("kipfilet");
    await cleanNameWithAI(actor, waiting);

    expect((await listNameableIngredients(actor)).map((it) => it.id)).toEqual([tonijn]);
  });

  it("gives a new food its plain name at once, keeping its flag and its old name as a spelling", async () => {
    const tonijn = await food("Lekkerste Tonijn Uit Blik");

    readsAs("tonijn uit blik");
    await giveNewIngredientItsPlainName(tonijn);

    expect(await row(tonijn)).toEqual({
      name: "tonijn uit blik",
      flagged: true,
      nameSettled: true,
    });
    expect(await spellings(tonijn)).toEqual(
      expect.arrayContaining(["Lekkerste Tonijn Uit Blik", "tonijn uit blik"])
    );
  });

  it("leaves a new food named as it was where another food spells its plain name, proposing the merge", async () => {
    const onion = await food("onion");
    const messy = await food("Verse Onion Deluxe");

    readsAs("onion");
    await giveNewIngredientItsPlainName(messy);

    expect(await row(messy)).toMatchObject({ name: "Verse Onion Deluxe", nameSettled: false });
    expect(await suggestionFor(messy)).toMatchObject({ kind: "merge", target: { id: onion } });
  });

  it("never renames a settled name from the words again", async () => {
    const tonijn = await food("Lekkerste Tonijn Uit Blik");

    readsAs("tonijn uit blik");
    await giveNewIngredientItsPlainName(tonijn);
    await adoptPlainName(tonijn, {
      text: "lekkerste tonijn",
      fold: ingredientAliasFold("lekkerste tonijn"),
    });

    expect(await row(tonijn)).toMatchObject({ name: "tonijn uit blik" });
  });

  it("drops a waiting rename once a person names the food themselves", async () => {
    const tonijn = await food("Lekkerste Tonijn Uit Blik");

    readsAs("tonijn uit blik");
    await cleanNameWithAI(actor, tonijn);
    await renameIngredient(actor, tonijn, "tonijn");

    expect(await suggestionFor(tonijn)).toBeNull();
    expect(await row(tonijn)).toMatchObject({ name: "tonijn", nameSettled: true });
  });
});
