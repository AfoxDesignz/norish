// @vitest-environment node
/**
 * The catalogue as the Ingredients page edits it, against a real database:
 * looking after a Flagged Ingredient clears its flag, a household's own word
 * joins the food it names, a delete leaves the lines and groceries behind a
 * food with their text and no food, and the nightly sweep deletes own foods
 * nothing has named for 90 days. The edit policy's matrix is pinned at the
 * procedures; here the editor is the Ingredient's owner.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CatalogueActor } from "@norish/shared-server/ingredients/catalogue";
import { listAIChanges } from "@norish/db/repositories/ingredient-ai-changes";
import {
  groceries,
  ingredientAliases,
  ingredients,
  pantryIngredients,
  recipeIngredientFoods,
  recipeIngredients,
  recurringGroceries,
} from "@norish/db/schema";
import { undoAIChange } from "@norish/shared-server/ingredients/ai-changes";
import {
  addAlias,
  CatalogueEditError,
  deleteIngredient,
  listIngredients,
  listSpellings,
  markDistinct,
  mergeIngredients,
  moveAlias,
  removeAlias,
  renameIngredient,
  saveDraft,
  setParent,
  sweepUnusedIngredients,
} from "@norish/shared-server/ingredients/catalogue";
import { publishIngredientChangesTo } from "@norish/shared-server/ingredients/changes";
import { resolveGroceryNames } from "@norish/shared-server/ingredients/groceries";
import { ingredientFor, resolveIngredients } from "@norish/shared-server/ingredients/resolver";

import {
  createTestRecipe,
  createTestUser,
  getRecipeIngredients,
  getSpellingTexts,
  getTestDb,
  insertTestRecipeLine,
} from "../../../db/__tests__/helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../db/__tests__/helpers/repository-test-base";

describe("the ingredient catalogue", () => {
  const testBase = new RepositoryTestBase("test_ingredient_catalogue");

  let actor: CatalogueActor;
  /** What the edits announced, one list of Ingredient ids per announcement. */
  let announced: string[][];
  let restorePublisher: () => void;

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    actor = { userId: user.id, householdUserIds: null, isServerAdmin: false };
    announced = [];
    restorePublisher = publishIngredientChangesTo({
      changed: async (ids) => {
        announced.push([...ids]);
      },
    });
  });

  afterEach(() => restorePublisher());

  afterAll(async () => {
    await testBase.teardown();
  });

  async function mint(text: string) {
    const [resolved] = await resolveIngredients([text], { userId: actor.userId });

    return resolved!;
  }

  /** A recipe line, a Grocery, a recurring grocery and a Pantry Ingredient, each naming `food` as `text`. */
  async function nameEverywhere(food: { aliasId: string; ingredientId: string }, text: string) {
    const db = getTestDb();
    const recipe = await createTestRecipe(actor.userId);
    const pointers = { ingredientAliasId: food.aliasId, ingredientId: food.ingredientId };
    const line = await insertTestRecipeLine({ recipeId: recipe.id, name: text }, [food.aliasId]);
    const [grocery] = await db
      .insert(groceries)
      .values({ userId: actor.userId, name: text, ...pointers })
      .returning({ id: groceries.id });
    const [recurring] = await db
      .insert(recurringGroceries)
      .values({
        userId: actor.userId,
        name: text,
        ...pointers,
        recurrenceRule: "week",
        nextPlannedFor: "2027-01-01",
      })
      .returning({ id: recurringGroceries.id });

    await db.insert(pantryIngredients).values({ userId: actor.userId, ...pointers });

    return { recipe: recipe.id, line: line.id, grocery: grocery!.id, recurring: recurring!.id };
  }

  /** What the rows `nameEverywhere` wrote point at now. */
  async function namedBy(rows: { line: string; grocery: string; recurring: string }) {
    const db = getTestDb();
    const [line] = await db
      .select({ name: recipeIngredients.name, aliasId: recipeIngredientFoods.ingredientAliasId })
      .from(recipeIngredients)
      .leftJoin(
        recipeIngredientFoods,
        eq(recipeIngredientFoods.recipeIngredientId, recipeIngredients.id)
      )
      .where(eq(recipeIngredients.id, rows.line));
    const pointersOf = async (table: typeof groceries | typeof recurringGroceries, id: string) =>
      (
        await db
          .select({
            name: table.name,
            aliasId: table.ingredientAliasId,
            ingredientId: table.ingredientId,
          })
          .from(table)
          .where(eq(table.id, id))
      )[0];
    const grocery = await pointersOf(groceries, rows.grocery);
    const recurring = await pointersOf(recurringGroceries, rows.recurring);
    const pantry = await db
      .select({ aliasId: pantryIngredients.ingredientAliasId })
      .from(pantryIngredients)
      .where(eq(pantryIngredients.userId, actor.userId));

    return { line, grocery, recurring, pantry: pantry.map((row) => row.aliasId) };
  }

  function refusal(promise: Promise<unknown>) {
    return promise.then(
      () => null,
      (error: unknown) => (error instanceof CatalogueEditError ? error.refusal : error)
    );
  }

  it("announces what a merge, an alias move and a new parent changed, and nothing refused", async () => {
    const onion = await mint("onion");
    const ui = await mint("ui");
    const allium = await mint("allium");
    const red = await mint("red onion");

    await mergeIngredients(actor, ui.ingredientId, onion.ingredientId);
    await addAlias(actor, onion.ingredientId, "ajuin");
    const [ajuin] = await resolveIngredients(["ajuin"], { userId: actor.userId });
    const moved = await moveAlias(actor, ajuin!.aliasId, null);

    await setParent(actor, red.ingredientId, allium.ingredientId);
    await refusal(setParent(actor, allium.ingredientId, allium.ingredientId));

    expect(announced).toEqual([
      [ui.ingredientId, onion.ingredientId],
      [onion.ingredientId],
      [onion.ingredientId, moved.ingredientId],
      [red.ingredientId, allium.ingredientId],
    ]);
  });

  it("saves a draft as one edit: the name, the parent and the spellings", async () => {
    const onion = await mint("onion");
    const allium = await mint("allium");

    await addAlias(actor, onion.ingredientId, "ajuin");
    const [ajuin] = await resolveIngredients(["ajuin"], { userId: actor.userId });

    announced = [];
    await saveDraft(actor, onion.ingredientId, {
      name: "Yellow onion",
      parentId: allium.ingredientId,
      add: ["ui"],
      remove: [ajuin!.aliasId],
    });

    const [saved] = (await listIngredients(actor, { id: onion.ingredientId })).items;

    expect(saved).toMatchObject({ name: "Yellow onion", parent: { id: allium.ingredientId } });
    expect(saved!.aliases.map((alias) => alias.text).sort()).toEqual([
      "Yellow onion",
      "onion",
      "ui",
    ]);
    expect(announced).toEqual([[onion.ingredientId, allium.ingredientId]]);
  });

  it("changes nothing when any part of a draft is refused", async () => {
    const onion = await mint("onion");
    const allium = await mint("allium");
    const garlic = await mint("garlic");

    // The last spelling added is one garlic already holds.
    announced = [];
    await expect(
      refusal(
        saveDraft(actor, onion.ingredientId, {
          name: "Yellow onion",
          parentId: allium.ingredientId,
          add: ["ui", "garlic"],
          remove: [],
        })
      )
    ).resolves.toBe("spelling-taken");

    const [kept] = (await listIngredients(actor, { id: onion.ingredientId })).items;

    expect(kept).toMatchObject({ name: "onion", parent: null });
    expect(kept!.aliases.map((alias) => alias.text)).toEqual(["onion"]);
    await expect(ingredientFor(garlic.aliasId)).resolves.toMatchObject({ name: "garlic" });
    expect(announced).toEqual([]);
  });

  it("refuses a draft that removes another food's spelling", async () => {
    const onion = await mint("onion");
    const garlic = await mint("garlic");

    await addAlias(actor, garlic.ingredientId, "knoflook");
    const [knoflook] = await resolveIngredients(["knoflook"], { userId: actor.userId });

    await expect(
      refusal(saveDraft(actor, onion.ingredientId, { add: [], remove: [knoflook!.aliasId] }))
    ).resolves.toBe("not-found");
  });

  it("clears the flag of an Ingredient a person renames", async () => {
    const onion = await mint("onion");

    await renameIngredient(actor, onion.ingredientId, "Onion");

    await expect(ingredientFor(onion.aliasId)).resolves.toMatchObject({
      name: "Onion",
      flagged: false,
    });
  });

  it("clears the flag of an Ingredient marked distinct, and leaves its name", async () => {
    const powder = await mint("onion powder");

    await markDistinct(actor, powder.ingredientId);

    await expect(ingredientFor(powder.aliasId)).resolves.toMatchObject({
      name: "onion powder",
      flagged: false,
    });
  });

  it("makes a new name one of the Ingredient's spellings", async () => {
    const onion = await mint("onion");

    await renameIngredient(actor, onion.ingredientId, "Yellow onion");

    const [again] = await resolveIngredients(["yellow onion"], { userId: actor.userId });

    expect(again!.ingredientId).toBe(onion.ingredientId);
  });

  it("deletes an Ingredient nothing uses, its spellings with it", async () => {
    const saffron = await mint("saffron");

    await addAlias(actor, saffron.ingredientId, "zafraan");
    await deleteIngredient(actor, saffron.ingredientId);

    await expect(ingredientFor(saffron.aliasId)).resolves.toBeNull();

    const [again] = await resolveIngredients(["zafraan"], { userId: actor.userId });

    // Minted afresh: the spelling went with the food.
    expect(again!.ingredientId).not.toBe(saffron.ingredientId);
    await expect(refusal(deleteIngredient(actor, saffron.ingredientId))).resolves.toBe("not-found");
  });

  it("deletes an Ingredient something uses: its lines and groceries keep their text and name no food, and it leaves the Pantry", async () => {
    const roller = await mint("deegroller");
    const rows = await nameEverywhere(roller, "1 deegroller");

    await deleteIngredient(actor, roller.ingredientId);

    await expect(ingredientFor(roller.aliasId)).resolves.toBeNull();
    await expect(namedBy(rows)).resolves.toEqual({
      line: { name: "1 deegroller", aliasId: null },
      grocery: { name: "1 deegroller", aliasId: null, ingredientId: null },
      recurring: { name: "1 deegroller", aliasId: null, ingredientId: null },
      pantry: [],
    });
  });

  it("deletes a food as junk: the lines naming only it go too, each restorable from Changed by AI", async () => {
    const melted = await mint("melted");
    const butter = await mint("butter");
    const rows = await nameEverywhere(melted, "melted");
    const joint = await insertTestRecipeLine({ recipeId: rows.recipe, name: "butter or melted" }, [
      butter.aliasId,
      melted.aliasId,
    ]);

    await deleteIngredient(actor, melted.ingredientId, { asJunk: true });

    const lines = await getRecipeIngredients(rows.recipe);

    // A line naming another food too only loses this one.
    expect(lines.map((line) => line.id)).toEqual([joint.id]);
    await expect(namedBy(rows)).resolves.toMatchObject({
      grocery: { name: "melted", aliasId: null },
      pantry: [],
    });
    const [change, ...others] = await listAIChanges();

    expect(others).toEqual([]);
    expect(change).toMatchObject({
      recipe: { id: rows.recipe },
      undo: { kind: "junk-line", line: { id: rows.line, name: "melted" } },
    });

    await undoAIChange(actor, change!.id);
    expect((await getRecipeIngredients(rows.recipe)).map((line) => line.id).sort()).toEqual(
      [joint.id, rows.line].sort()
    );
  });

  it("deletes as junk only the lines of recipes the person may edit; others lose the food alone", async () => {
    const melted = await mint("melted");
    const stranger = await createTestUser();
    const theirs = await createTestRecipe(stranger.id);
    const line = await insertTestRecipeLine({ recipeId: theirs.id, name: "melted" }, [
      melted.aliasId,
    ]);

    await deleteIngredient(actor, melted.ingredientId, { asJunk: true });

    // Not theirs to change: the line stays, with no food, as a plain Delete leaves it.
    expect(await getRecipeIngredients(theirs.id)).toMatchObject([
      { id: line.id, ingredientId: null },
    ]);
    await expect(listAIChanges()).resolves.toEqual([]);
  });

  it("refuses a name another Ingredient goes by, in any case", async () => {
    await mint("garlic");
    const leek = await mint("leek");

    await expect(refusal(renameIngredient(actor, leek.ingredientId, "Garlic"))).resolves.toBe(
      "name-taken"
    );
  });

  it("undoes a rename whose new spelling cannot be written, the old name kept", async () => {
    const leek = await mint("leek");
    const db = getTestDb();

    // Stands in for any failure after the rename's first write.
    await db.execute(sql`
      create or replace function refuse_alias() returns trigger language plpgsql as
        $$ begin raise exception 'alias refused'; end $$`);
    await db.execute(sql`
      create trigger refuse_alias before insert on ingredient_aliases
        for each row execute function refuse_alias()`);
    try {
      await expect(renameIngredient(actor, leek.ingredientId, "Winter leek")).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger refuse_alias on ingredient_aliases`);
      await db.execute(sql`drop function refuse_alias()`);
    }

    await expect(ingredientFor(leek.aliasId)).resolves.toMatchObject({
      name: "leek",
      flagged: true,
    });
  });

  it("files a household's own word under the food it names", async () => {
    const onion = await mint("onion");

    await addAlias(actor, onion.ingredientId, "Ajuin");

    const [typed] = await resolveGroceryNames([{ name: "ajuin" }], { userId: actor.userId });

    expect(typed?.ingredientId).toBe(onion.ingredientId);
  });

  it("stores a spelling a person types clean, as a recipe text is read, single brackets kept", async () => {
    const gyoza = await mint("gyoza");

    await addAlias(actor, gyoza.ingredientId, "Gyoza vellen ((diepvries))");
    await addAlias(actor, gyoza.ingredientId, "gyoza (vers) )");
    await renameIngredient(actor, gyoza.ingredientId, "Japanse gyoza ((vers))");

    await expect(getSpellingTexts(gyoza.ingredientId)).resolves.toEqual([
      "Gyoza vellen",
      "Japanse gyoza",
      "gyoza",
      "gyoza (vers)",
    ]);
    await expect(refusal(addAlias(actor, gyoza.ingredientId, "(($0.02))"))).resolves.toBe("empty");
    expect((await mint("gyoza vellen ((diepvries))")).ingredientId).toBe(gyoza.ingredientId);
  });

  it("refuses a spelling another food already holds", async () => {
    const onion = await mint("onion");
    await mint("garlic");

    await expect(refusal(addAlias(actor, onion.ingredientId, "Garlic!"))).resolves.toBe(
      "spelling-taken"
    );
  });

  /** Spellings added to a food one after another, so each is younger than the last. */
  async function spell(ingredientId: string, texts: string[]) {
    for (const text of texts) await addAlias(actor, ingredientId, text);

    return await resolveIngredients(texts, { userId: actor.userId });
  }

  it("removes a spelling something uses: what wrote it keeps its text and its food, under the spelling that is the food's name", async () => {
    const dough = await mint("dough");
    const [, roller] = await spell(dough.ingredientId, ["deeg", "deegroller"]);
    const rows = await nameEverywhere(roller!, "deegroller");

    await removeAlias(actor, roller!.aliasId);

    const named = { aliasId: dough.aliasId, ingredientId: dough.ingredientId };

    await expect(namedBy(rows)).resolves.toEqual({
      line: { name: "deegroller", aliasId: dough.aliasId },
      grocery: { name: "deegroller", ...named },
      recurring: { name: "deegroller", ...named },
      pantry: [dough.aliasId],
    });
    await expect(getSpellingTexts(dough.ingredientId)).resolves.toEqual(["deeg", "dough"]);
  });

  it("moves what wrote a spelling with it: a line, a Grocery, a recurring grocery and a Pantry Ingredient name the food it moves to", async () => {
    const onion = await mint("onion");
    const [ajuin] = await spell(onion.ingredientId, ["ajuin"]);
    const rows = await nameEverywhere(ajuin!, "ajuin");
    const moved = await moveAlias(actor, ajuin!.aliasId, null);
    const named = { aliasId: ajuin!.aliasId, ingredientId: moved.ingredientId };

    await expect(namedBy(rows)).resolves.toEqual({
      line: { name: "ajuin", aliasId: ajuin!.aliasId },
      grocery: { name: "ajuin", ...named },
      recurring: { name: "ajuin", ...named },
      pantry: [ajuin!.aliasId],
    });
    await expect(getRecipeIngredients(rows.recipe)).resolves.toMatchObject([
      { name: "ajuin", ingredientId: moved.ingredientId },
    ]);
  });

  it("moves what wrote a removed spelling to the food's oldest one, where the name's own is the one removed", async () => {
    const dough = await mint("dough");
    const [deeg] = await spell(dough.ingredientId, ["deeg", "pâte"]);
    const rows = await nameEverywhere(dough, "dough");

    await removeAlias(actor, dough.aliasId);

    const named = { aliasId: deeg!.aliasId, ingredientId: dough.ingredientId };

    await expect(namedBy(rows)).resolves.toEqual({
      line: { name: "dough", aliasId: deeg!.aliasId },
      grocery: { name: "dough", ...named },
      recurring: { name: "dough", ...named },
      pantry: [deeg!.aliasId],
    });
  });

  it("says why a food is flagged, and sends the viewer's spellings with the rest on request", async () => {
    const cream = await mint("cream");

    await addAlias(actor, cream.ingredientId, "room");

    const page = await listIngredients(actor, { search: "cream", locale: "nl" });

    // Minted without AI in these tests: that is the reason.
    expect(page.items[0]).toMatchObject({
      flagged: true,
      flagReason: "ai-off",
      hiddenSpellings: 0,
    });
    expect(page.items[0]!.aliases.map((alias) => alias.text)).toEqual(["cream", "room"]);
    expect((await listSpellings(actor, cream.ingredientId)).map((alias) => alias.text)).toEqual([
      "cream",
      "room",
    ]);

    await markDistinct(actor, cream.ingredientId);
    expect((await listIngredients(actor, { search: "cream" })).items[0]).toMatchObject({
      flagged: false,
      flagReason: null,
    });
  });

  it("never removes an Ingredient's last spelling", async () => {
    const saffron = await mint("saffron");

    await expect(refusal(removeAlias(actor, saffron.aliasId))).resolves.toBe("last-alias");
  });

  it("finds an Ingredient by any of its spellings, folded, and lists the flagged ones apart", async () => {
    const creme = await mint("crème fraîche");

    await markDistinct(actor, creme.ingredientId);
    await mint("cream");

    const search = await listIngredients(actor, { search: "CREME" });

    expect(search.items.map((item) => item.name)).toEqual(["crème fraîche"]);
    expect(search.items[0]).toMatchObject({ canEdit: true, flagged: false });

    const flagged = await listIngredients(actor, { flaggedOnly: true });

    expect(flagged.items.map((item) => item.name)).toEqual(["cream"]);
  });

  it("finds the text anywhere by default, exactly on request, in the fields asked for, the flagged first", async () => {
    const cola = await mint("cola");
    const chocolate = await mint("chocolate");
    const nut = await mint("cola nut");

    await markDistinct(actor, cola.ingredientId);
    await markDistinct(actor, chocolate.ingredientId);
    await addAlias(actor, chocolate.ingredientId, "chocola");

    const names = async (
      search: string,
      options: {
        match?: "contains" | "exact";
        fields?: Array<"name" | "translations" | "parent">;
      } = {}
    ) => (await listIngredients(actor, { search, ...options })).items.map((item) => item.name);

    // Anywhere in a name or a translation: the exact name first, then the flagged one.
    await expect(names("cola")).resolves.toEqual(["cola", "cola nut", "chocolate"]);
    // Exactly this.
    await expect(names("Cola", { match: "exact" })).resolves.toEqual(["cola"]);
    // Without a search, the flagged lead.
    expect((await listIngredients(actor, {})).items[0]!.id).toBe(nut.ingredientId);
    // Only where asked: by parent alone, the kinds of cola. (Filing it clears its flag.)
    await setParent(actor, nut.ingredientId, cola.ingredientId);
    await expect(names("cola", { fields: ["parent"] })).resolves.toEqual(["cola nut"]);
  });

  it("leaves another member's Ingredient alone under the default household policy", async () => {
    const onion = await mint("onion");
    const stranger = await createTestUser();

    await expect(
      refusal(
        renameIngredient(
          { userId: stranger.id, householdUserIds: null, isServerAdmin: false },
          onion.ingredientId,
          "Onions"
        )
      )
    ).resolves.toBe("forbidden");
  });

  describe("the nightly sweep of unused foods", () => {
    /** Backdate the sweep's mark, as though it had found the food unused `days` (and `hours` less) ago. */
    async function unusedFor(ingredientId: string, days: number, hours = 0) {
      await getTestDb()
        .update(ingredients)
        .set({ unusedSince: sql`now() - make_interval(days => ${days}, hours => ${-hours})` })
        .where(eq(ingredients.id, ingredientId));
    }

    async function unusedSince(ingredientId: string) {
      const [row] = await getTestDb()
        .select({ unusedSince: ingredients.unusedSince })
        .from(ingredients)
        .where(eq(ingredients.id, ingredientId));

      return row?.unusedSince ?? null;
    }

    it("deletes an own food nothing has named for 90 days, and keeps one unused for 89", async () => {
      const box = await mint("action grote doos");
      const lights = await mint("kerstverlichting");

      await sweepUnusedIngredients();
      await unusedFor(box.ingredientId, 90);
      await unusedFor(lights.ingredientId, 89);
      announced = [];
      await sweepUnusedIngredients();

      await expect(ingredientFor(box.aliasId)).resolves.toBeNull();
      await expect(ingredientFor(lights.aliasId)).resolves.toMatchObject({
        name: "kerstverlichting",
      });
      expect(announced).toEqual([[box.ingredientId]]);
    });

    it("deletes on the 90th night a food the first night marked, though this run started earlier in the day", async () => {
      const tin = await mint("taartvorm 26 cm");

      await sweepUnusedIngredients();
      await unusedFor(tin.ingredientId, 90, 1);
      await sweepUnusedIngredients();

      await expect(ingredientFor(tin.aliasId)).resolves.toBeNull();
    });

    it("keeps a parent while it has a child, and deletes it the night after its last child goes", async () => {
      const fries = await mint("zoete aardappel friet");
      const oven = await mint("ovenfriet zoete aardappel");
      const nora = await mint("nora brokken");
      const treats = await mint("smul rondjes nora");

      await setParent(actor, oven.ingredientId, fries.ingredientId);
      await setParent(actor, treats.ingredientId, nora.ingredientId);
      await getTestDb().insert(groceries).values({
        userId: actor.userId,
        name: "ovenfriet zoete aardappel",
        ingredientAliasId: oven.aliasId,
        ingredientId: oven.ingredientId,
      });
      await sweepUnusedIngredients();
      for (const food of [fries, nora, treats]) await unusedFor(food.ingredientId, 100);

      // The child something uses keeps its parent; an unused child goes before its parent.
      await sweepUnusedIngredients();
      await expect(ingredientFor(fries.aliasId)).resolves.not.toBeNull();
      await expect(ingredientFor(treats.aliasId)).resolves.toBeNull();
      await expect(ingredientFor(nora.aliasId)).resolves.not.toBeNull();

      await sweepUnusedIngredients();
      await expect(ingredientFor(nora.aliasId)).resolves.toBeNull();
      await expect(ingredientFor(fries.aliasId)).resolves.not.toBeNull();
    });

    it.each([
      ["a recipe line", "line"],
      ["a Grocery through its spelling", "grocery-spelling"],
      ["a Grocery through the food alone", "grocery-food"],
      ["a recurring grocery through its spelling", "recurring-spelling"],
      ["a recurring grocery through the food alone", "recurring-food"],
      ["a Pantry Ingredient", "pantry"],
    ] as const)("keeps a food %s names", async (_, by) => {
      const food = await mint("ijsblokjesvorm");
      const db = getTestDb();
      const spelling = { ingredientAliasId: food.aliasId };
      const itself = { ingredientId: food.ingredientId };
      const repeat = { recurrenceRule: "week", nextPlannedFor: "2027-01-01" };

      if (by === "line") {
        const recipe = await createTestRecipe(actor.userId);

        await insertTestRecipeLine({ recipeId: recipe.id, name: "ijsblokjesvorm" }, [food.aliasId]);
      }
      if (by === "grocery-spelling" || by === "grocery-food") {
        await db.insert(groceries).values({
          userId: actor.userId,
          name: "ijsblokjesvorm",
          ...(by === "grocery-spelling" ? spelling : itself),
        });
      }
      if (by === "recurring-spelling" || by === "recurring-food") {
        await db.insert(recurringGroceries).values({
          userId: actor.userId,
          name: "ijsblokjesvorm",
          ...repeat,
          ...(by === "recurring-spelling" ? spelling : itself),
        });
      }
      if (by === "pantry")
        await db.insert(pantryIngredients).values({ userId: actor.userId, ...itself });

      await unusedFor(food.ingredientId, 100);
      await sweepUnusedIngredients();

      await expect(unusedSince(food.ingredientId)).resolves.toBeNull();
      await expect(ingredientFor(food.aliasId)).resolves.not.toBeNull();
    });

    it("clears the mark once something names the food again", async () => {
      const salt = await mint("vaatwaszout");

      await sweepUnusedIngredients();
      await expect(unusedSince(salt.ingredientId)).resolves.not.toBeNull();

      await getTestDb().insert(groceries).values({
        userId: actor.userId,
        name: "vaatwaszout",
        ingredientAliasId: salt.aliasId,
        ingredientId: salt.ingredientId,
      });
      await unusedFor(salt.ingredientId, 100);
      await sweepUnusedIngredients();

      await expect(unusedSince(salt.ingredientId)).resolves.toBeNull();
      await expect(ingredientFor(salt.aliasId)).resolves.toMatchObject({ name: "vaatwaszout" });
    });

    it("keeps a food only a recurring grocery names, and never deletes a seeded one", async () => {
      const filter = await mint("waterfilter");
      const [seeded] = await getTestDb()
        .insert(ingredients)
        .values({ name: "amaranth", offId: "en:amaranth" })
        .returning({ id: ingredients.id });
      const [seededAlias] = await getTestDb()
        .insert(ingredientAliases)
        .values({ text: "amaranth", fold: "amaranth", ingredientId: seeded!.id, seeded: true })
        .returning({ id: ingredientAliases.id });

      await getTestDb().insert(recurringGroceries).values({
        userId: actor.userId,
        name: "waterfilter",
        ingredientAliasId: filter.aliasId,
        ingredientId: filter.ingredientId,
        recurrenceRule: "year",
        nextPlannedFor: "2027-06-01",
      });
      await sweepUnusedIngredients();
      await expect(unusedSince(filter.ingredientId)).resolves.toBeNull();
      await expect(unusedSince(seeded!.id)).resolves.toBeNull();

      await unusedFor(filter.ingredientId, 100);
      await unusedFor(seeded!.id, 100);
      await sweepUnusedIngredients();

      const left = await getTestDb()
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(inArray(ingredients.id, [filter.ingredientId, seeded!.id]));

      expect(left).toHaveLength(2);
      await expect(ingredientFor(seededAlias!.id)).resolves.toMatchObject({ name: "amaranth" });
    });
  });
});
