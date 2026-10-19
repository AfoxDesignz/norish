/**
 * The ingredient catalogue, in a browser.
 *
 * What a household actually sees: a Dutch "ui" put in the Pantry leaves an
 * English recipe's "onion" off the list, because both are spellings of one
 * Ingredient; a food Norish was not sure about is marked on the Ingredients
 * page; AI's answer about a flagged food is made, listed on Changed by AI
 * and undone from there; merging it into the food that holds an Aisle Link
 * files its grocery in that aisle; and a recipe line naming two foods puts
 * each on the list on its own. The scenario seeds a small catalogue of its own
 * rather than fetching Open Food Facts. The real Norish server, database,
 * Redis, tRPC and realtime are all in the path; nothing outbound is.
 */
import type { Locator, Page } from "@playwright/test";

import { callTrpc, queryTrpc } from "../harness/trpc";
import { expect, test } from "./fixture";
import {
  readIngredientOf,
  resetCatalogueScenario,
  seedCatalogue,
  seedStoreFiling,
  setParent,
  settleNamesExcept,
} from "./ingredient-catalogue-support";
import { readGroceryNames, readPantryNames, seedRecipeWithIngredients } from "./pantry-support";

test.describe.configure({ mode: "serial" });

const RECIPE = "Onion soup";
/** A page of the catalogue is fifty; these fill one and start another. */
const FILLER_COUNT = 55;
const fillerName = (n: number) => `zz filler ${String(n).padStart(2, "0")}`;
const STORE = "Groenteboer";
const AISLE = "Groente";

let page: Page;
let recipeId: string;
/** The seeded foods' ids, by name. */
let ids: Record<string, string>;

test.beforeAll(async ({ browser, aiStack }) => {
  await resetCatalogueScenario();

  ids = await seedCatalogue([
    {
      name: "onion",
      aliases: [
        { text: "onion", locale: "en" },
        { text: "onions", locale: "en" },
        { text: "ui", locale: "nl" },
      ],
    },
    { name: "uitjes", aliases: [{ text: "uitjes", locale: "nl" }], flagged: true },
    // Flagged too, for Ask AI to merge into garlic, so "uitjes" stays for the merge below.
    {
      name: "knoflookteentjes",
      aliases: [{ text: "knoflookteentjes", locale: "nl" }],
      flagged: true,
    },
    {
      name: "garlic",
      aliases: [
        { text: "garlic", locale: "en" },
        { text: "knoflook", locale: "nl" },
      ],
    },
    { name: "red onion", aliases: [{ text: "red onion", locale: "en" }] },
    { name: "shallot", aliases: [{ text: "shallot", locale: "en" }] },
    // Enough foods, sorted last, for the list to have a second page to scroll to.
    ...Array.from({ length: FILLER_COUNT }, (_, index) => {
      const name = fillerName(index + 1);

      return { name, aliases: [{ text: name, locale: "en" }] };
    }),
  ]);

  await setParent(ids["red onion"]!, ids.onion!);

  await seedStoreFiling(STORE, AISLE, ids.onion!);
  recipeId = await seedRecipeWithIngredients(RECIPE, ["onion", "butter"]);

  const context = await browser.newContext({
    baseURL: aiStack.baseURL,
    storageState: { cookies: aiStack.ownerCookies, origins: [] },
  });

  page = await context.newPage();
});

test.afterAll(async () => {
  await page?.context().close();
});

/** The Pantry page, reached from the groceries page's switch. */
async function openPantry(): Promise<Locator> {
  await page.goto("/groceries");
  await page.getByRole("tab", { name: "Pantry" }).click();
  await expect(page).toHaveURL(/\/groceries\/pantry$/);

  return page.locator("main");
}

/** The Ingredients page's row for an Ingredient, by its own name. */
function ingredientRow(name: string): Locator {
  return page.locator(`[data-testid="ingredient-row"][data-ingredient="${name}"]`);
}

/** The Store's block on the grocery list. */
function storeBlock(): Locator {
  return page
    .locator("[data-store-id]")
    .filter({ has: page.locator("[data-store-drop-target]").filter({ hasText: STORE }) })
    .last();
}

/** The rows the Store files under an aisle. */
async function rowsIn(aisleName: string): Promise<string[]> {
  return storeBlock()
    .locator("[data-aisle-id]")
    .filter({ has: page.getByTestId("aisle-heading").filter({ hasText: aisleName }) })
    .locator("[data-grocery-name]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-grocery-name") ?? ""));
}

test("a Dutch 'ui' in the Pantry leaves an English recipe's 'onion' off the list", async () => {
  const pantry = await openPantry();

  await pantry.getByTestId("pantry-name").fill("ui");
  await pantry.getByTestId("pantry-name").press("Enter");
  // "ui" is a spelling of onion: the Pantry holds the Ingredient, shown by its name.
  await expect(pantry.locator('[data-pantry-ingredient="onion"]')).toHaveText("onion");
  await expect.poll(readPantryNames).toEqual(["onion"]);

  await page.goto(`/recipes/${recipeId}`);
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  const panel = page.getByRole("dialog", { name: "Add to Groceries" });
  const held = panel.getByTestId("pantry-section");

  await expect(held.getByRole("checkbox", { name: "onion" })).not.toBeChecked();
  await expect(panel.getByRole("checkbox", { name: "butter" })).toBeChecked();
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect.poll(readGroceryNames).toEqual(["butter"]);
});

test("the list asks for its next page as the end comes into view", async () => {
  await page.goto("/settings?tab=ingredients");
  await expect(ingredientRow("uitjes")).toBeVisible();
  // The last food is on the second page: not there until the end is reached.
  await expect(ingredientRow(fillerName(FILLER_COUNT))).toHaveCount(0);

  // The list is virtualised, so the end is scrolled to as many times as pages land.
  await expect
    .poll(
      async () => {
        await page.getByTestId("ingredients-list-end").scrollIntoViewIfNeeded();

        return ingredientRow(fillerName(FILLER_COUNT)).count();
      },
      { timeout: 15_000 }
    )
    .toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
});

test("a food's name, parent and translations land together with Save", async () => {
  const before = fillerName(1);
  const after = "zz filler one";

  await page.goto("/settings?tab=ingredients");
  await page.getByTestId("ingredients-search").fill(before);
  await ingredientRow(before).getByTestId("ingredient-toggle").click();
  const opened = ingredientPanel(before);

  await expect(opened.getByTestId("ingredient-save")).toBeDisabled();
  await opened.getByTestId("ingredient-name-input").fill(after);
  // Translations are a click through, in a panel of their own.
  await opened.getByTestId("ingredient-all-spellings").click();
  const spellings = page.getByRole("dialog", { name: "Translations" });

  await spellings.getByTestId("ingredient-alias-input").fill("vulling");
  await spellings.getByTestId("ingredient-alias-input").press("Enter");
  await spellings.getByRole("button", { name: "Done" }).click();
  // A parent is picked in a panel of its own and joins the draft.
  await opened.getByTestId("ingredient-set-parent").click();
  const asking = page.getByRole("dialog", { name: "Set parent…" });

  await asking.getByTestId("ingredient-picker").fill("onion");
  await page.getByRole("option", { name: "onion", exact: true }).click();
  await asking.getByTestId("ingredient-relocation-confirm").click();
  await expect(opened.getByTestId("ingredient-parent")).toContainText("onion");
  // Nothing has landed yet.
  await expect.poll(() => readIngredientOf("vulling")).toBeNull();

  await opened.getByTestId("ingredient-save").click();
  await expect(opened.getByTestId("ingredient-save")).toBeDisabled();
  await page.getByTestId("ingredients-search").fill(after);
  await expect(ingredientRow(after)).toBeVisible();
  await expect(ingredientRow(after)).toContainText("3 translations, parent: onion");
  await expect.poll(() => readIngredientOf("vulling")).not.toBeNull();

  await opened.getByRole("button", { name: "Close panel" }).click();
  await expect(opened).toBeHidden();

  // With nothing typed, the list is the tree of kinds: the food is no longer
  // a root, and folds out under onion.
  await page.getByTestId("ingredients-search").fill("");
  await expect(ingredientRow("onion")).toBeVisible();
  await expect(ingredientRow(after)).toHaveCount(0);
  await ingredientRow("onion").getByTestId("ingredient-kinds-toggle").click();
  await expect(ingredientRow(after)).toBeVisible();
  await expect(ingredientRow(after)).toHaveAttribute("data-depth", "1");
  await expect(ingredientRow("red onion")).toHaveAttribute("data-depth", "1");
  await ingredientRow("onion").getByTestId("ingredient-kinds-toggle").click();
  await expect(ingredientRow(after)).toHaveCount(0);
});

test("a food Norish was not sure about is marked on the Ingredients page", async () => {
  await page.goto("/settings?tab=ingredients");
  // The filters sit in a panel and land with Apply, as the dashboard's do.
  await page.getByTestId("ingredients-filters").click();
  const filters = page.getByRole("dialog", { name: "Filters" });

  const flaggedOnly = filters.getByRole("switch", { name: "Only flagged" });

  await flaggedOnly.press("Space");
  await expect(flaggedOnly).toBeChecked();
  await filters.getByTestId("ingredients-filters-apply").click();
  await expect(filters).toBeHidden();

  await expect(ingredientRow("uitjes").getByTestId("ingredient-flagged")).toBeVisible();
  await expect(ingredientRow("uitjes").getByTestId("ingredient-flag-reason")).toBeVisible();
  await expect(ingredientRow("onion")).toHaveCount(0);

  // The page offers to fix the catalogue at once; a food's own panel says why
  // it is flagged and offers to ask about it alone.
  await expect(page.getByTestId("ingredients-fix-catalogue")).toBeVisible();
  await ingredientRow("uitjes").getByTestId("ingredient-toggle").click();
  const opened = ingredientPanel("uitjes");

  await expect(opened.getByTestId("ingredient-flag-notice")).toBeVisible();
  await expect(opened.getByTestId("ingredient-ask-ai")).toBeVisible();
  await opened.getByRole("button", { name: "Close panel" }).click();
  await expect(opened).toBeHidden();
});

test("the filters can show only the foods with neither parent nor kinds", async () => {
  await page.goto("/settings?tab=ingredients");
  await page.getByTestId("ingredients-filters").click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  const standalone = filters.getByRole("switch", { name: "Without parent or kinds" });

  await standalone.press("Space");
  await expect(standalone).toBeChecked();
  await filters.getByTestId("ingredients-filters-apply").click();
  await expect(filters).toBeHidden();

  // onion has kinds and red onion a parent: neither is listed; shallot is.
  await expect(ingredientRow("shallot")).toBeVisible();
  await expect(ingredientRow("onion")).toHaveCount(0);
  await expect(ingredientRow("red onion")).toHaveCount(0);
  // The header offers to find their parents with AI, and a food's panel to find its own.
  await expect(page.getByTestId("ingredients-find-parents-all")).toBeVisible();
  await ingredientRow("shallot").getByTestId("ingredient-toggle").click();
  await expect(ingredientPanel("shallot").getByTestId("ingredient-find-parent")).toBeVisible();
  await ingredientPanel("shallot").getByRole("button", { name: "Close panel" }).click();
});

test("Ask AI merges a flagged food, Changed by AI lists the merge, and Undo puts it back", async ({
  ai,
}) => {
  // The language model reads the name, then compares it with what that reading finds: garlic.
  ai.control.enqueue(
    {
      kind: "success",
      content: JSON.stringify({ englishName: "garlic", generalFood: null, sure: true }),
    },
    {
      kind: "success",
      content: JSON.stringify({ verdict: "same", food: 1, sure: true, englishName: "garlic" }),
    }
  );
  await page.goto("/settings?tab=ingredients");
  await page.getByTestId("ingredients-search").fill("knoflook");
  await ingredientRow("knoflookteentjes").getByTestId("ingredient-toggle").click();
  await ingredientPanel("knoflookteentjes").getByTestId("ingredient-ask-ai").click();

  // AI makes its answer itself: merged away, the food's panel closes with its row.
  await expect(ingredientPanel("knoflookteentjes")).toBeHidden({ timeout: 30_000 });
  await expect(ingredientRow("knoflookteentjes")).toHaveCount(0);
  await expect.poll(() => readIngredientOf("knoflookteentjes")).toBe("garlic");

  // Changed by AI lists the merge under the food it joined, with Undo.
  await page.getByTestId("ingredients-ai-changes-open").click();
  const panel = page.getByRole("dialog", { name: "Changed by AI" });
  const merge = panel.getByTestId("ingredient-ai-change");

  await expect(merge).toHaveAttribute("data-kind", "merge");
  await expect(merge).toContainText("garlic");
  await expect(merge).toContainText("Merged knoflookteentjes into it");
  // The panel is a phone's width on a desktop too; its rows never scroll it sideways.
  const panelBody = panel.locator('[data-slot="panel-body"]');

  expect(await panelBody.evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);

  await merge.getByTestId("ingredient-ai-change-undo").click();
  await expect(merge).toHaveCount(0);
  await expect(panel.getByText("AI changed nothing in the last month.")).toBeVisible();
  await panel.getByRole("button", { name: "Close panel" }).click();
  // Its spelling is a food of its own again, back on the page.
  await expect.poll(() => readIngredientOf("knoflookteentjes")).toBe("knoflookteentjes");
  await expect(ingredientRow("knoflookteentjes")).toBeVisible();
});

/** The panel a row opens: a dialog named after the food. */
function ingredientPanel(name: string) {
  return page.getByRole("dialog", { name, exact: true });
}

/** Add a grocery under the Store, through the panel a shopper uses. */
async function addGrocery(name: string): Promise<void> {
  await page.goto("/groceries");
  await page.getByRole("button", { name: "Add Item" }).click();
  await page.getByPlaceholder("e.g., 2 lbs chicken breast").fill(name);
  await page.getByRole("button", { name: /Auto-detect from history/ }).click();
  await page.getByRole("option", { name: STORE }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(storeBlock().locator(`[data-grocery-name="${name}"]`)).toBeVisible();
}

test("a kind of a food with no aisle of its own is filed in its parent's", async () => {
  await addGrocery("red onion");

  await expect.poll(() => rowsIn(AISLE)).toEqual(["red onion"]);
});

test("merging it into the food that holds an Aisle Link files its grocery in that aisle", async () => {
  await addGrocery("uitjes");
  await expect.poll(() => rowsIn(AISLE)).toEqual(["red onion"]);

  await page.goto("/settings?tab=ingredients");
  await ingredientRow("uitjes").getByTestId("ingredient-toggle").click();
  await ingredientPanel("uitjes").getByTestId("ingredient-merge").click();
  // Picking what to merge into is a panel over the food's own.
  const asking = page.getByRole("dialog", { name: "Merge into…" });

  await asking.getByTestId("ingredient-picker").fill("onion");
  await page.getByRole("option", { name: "onion", exact: true }).click();
  await asking.getByTestId("ingredient-relocation-confirm").click();
  // Merged away, the food's panel closes with its row.
  await expect(ingredientPanel("uitjes")).toBeHidden();
  await expect(ingredientRow("uitjes")).toHaveCount(0);
  await expect.poll(() => readIngredientOf("uitjes")).toBe("onion");

  await page.goto("/groceries");
  await expect
    .poll(async () => (await rowsIn(AISLE)).sort((a, b) => a.localeCompare(b)))
    .toEqual(["red onion", "uitjes"]);
});

test("a food nothing uses can be deleted, and so can one a grocery uses, which stays on the list", async () => {
  await page.goto("/settings?tab=ingredients");

  await ingredientRow("shallot").getByTestId("ingredient-toggle").click();
  await ingredientPanel("shallot").getByTestId("ingredient-delete").click();
  await page.getByTestId("ingredient-delete-confirm").click();
  await expect(ingredientPanel("shallot")).toBeHidden();
  await expect(ingredientRow("shallot")).toHaveCount(0);
  await expect.poll(() => readIngredientOf("shallot")).toBeNull();

  // "red onion" is on the grocery list: the dialog says so, and the grocery keeps its text.
  await ingredientRow("onion").getByTestId("ingredient-kinds-toggle").click();
  await ingredientRow("red onion").getByTestId("ingredient-toggle").click();
  await ingredientPanel("red onion").getByTestId("ingredient-delete").click();
  await expect(page.getByTestId("ingredient-delete-touches")).toHaveText(
    /grocer(y keeps its|ies keep their) text without it/
  );
  await page.getByTestId("ingredient-delete-confirm").click();
  await expect(ingredientRow("red onion")).toHaveCount(0);
  await expect.poll(() => readIngredientOf("red onion")).toBeNull();

  await page.goto("/groceries");
  await expect(page.locator('[data-grocery-name="red onion"]').first()).toBeVisible();
  // With no food it has no aisle, so it leaves its parent's.
  await expect.poll(() => rowsIn(AISLE)).toEqual(["uitjes"]);
});

test("cleaning names with AI renames each food to its plain name, listed on Changed by AI", async ({
  ai,
}) => {
  const tonijn = await seedCatalogue([
    {
      name: "GR TONIJN UIT BLIK",
      aliases: [{ text: "GR TONIJN UIT BLIK", locale: null }],
      flagged: false,
    },
  ]);

  await settleNamesExcept([tonijn["GR TONIJN UIT BLIK"]!]);
  ai.control.enqueue({
    kind: "success",
    content: JSON.stringify({ plainName: "tonijn uit blik" }),
  });
  await page.goto("/settings?tab=ingredients");
  await page.getByTestId("ingredients-search").fill("tonijn");
  await expect(ingredientRow("GR TONIJN UIT BLIK")).toBeVisible();

  // Fix catalogue asks first, saying how many names and about what cleaning them costs.
  await page.getByTestId("ingredients-fix-catalogue").click();
  const dialog = page.getByTestId("ingredients-fix-catalogue-dialog");
  const names = dialog.getByTestId("ingredients-fix-catalogue-scope-name");

  const flagged = dialog.getByRole("checkbox", { name: "Check flagged ingredients" });

  await expect(names).toContainText(/1 ingredient · about [\d.,]+K? tokens/);
  await expect(names.getByRole("checkbox", { name: "Clean names" })).toBeChecked();
  // Only the names, so the model's one answer goes to the one question; whatever earlier tests
  // left flagged waits. A HeroUI checkbox toggles from its label, not its hidden input.
  if (await flagged.isChecked()) {
    await dialog.getByText("Check flagged ingredients", { exact: true }).click();
  }
  await expect(flagged).not.toBeChecked();
  await expect(dialog.getByTestId("ingredients-fix-catalogue-models")).toContainText(
    "generic-openai · test-model"
  );
  ai.control.hold();
  await dialog.getByTestId("ingredients-fix-catalogue-start").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("ingredients-round-progress")).toContainText("Asking AI · 0 of 1");
  ai.control.release();

  // The round ends with Changed by AI open, the rename already made.
  const panel = page.getByRole("dialog", { name: "Changed by AI" });

  await expect(panel).toBeVisible({ timeout: 30_000 });
  const rename = panel.getByTestId("ingredient-ai-change");

  await expect(rename).toHaveAttribute("data-kind", "plain-name");
  await expect(rename).toContainText("tonijn uit blik");
  await expect(rename).toContainText("Renamed from GR TONIJN UIT BLIK");
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(ingredientRow("tonijn uit blik")).toBeVisible();
  await expect.poll(() => readIngredientOf("GR TONIJN UIT BLIK")).toBe("tonijn uit blik");
});

test("a recipe line naming two foods puts each on the list as a grocery of its own", async ({
  aiStack,
}) => {
  await seedCatalogue([
    { name: "zout", aliases: [{ text: "zout", locale: "nl" }] },
    { name: "peper", aliases: [{ text: "peper", locale: "nl" }] },
  ]);
  const id = await callTrpc<string>(aiStack.baseURL, aiStack.ownerCookies, "recipes.create", {
    name: "Gebakken eieren",
    systemUsed: "metric",
    servings: 2,
    recipeIngredients: [
      { ingredientName: "zout en peper", ingredientId: null, amount: null, unit: null, order: 0 },
    ],
    steps: [],
    tags: [],
    cuisines: [],
    categories: [],
    images: [],
    videos: [],
  });
  // The create answers before the recipe is written, and a recipe not written yet is not found.
  const lineFoods = () =>
    queryTrpc<{ recipeIngredients: Array<{ foods?: Array<{ name: string }> }> }>(
      aiStack.baseURL,
      aiStack.ownerCookies,
      "recipes.get",
      { id }
    ).then(
      (recipe) => recipe.recipeIngredients[0]?.foods?.map((food) => food.name),
      () => undefined
    );

  await expect.poll(lineFoods).toEqual(["zout", "peper"]);

  await page.goto(`/recipes/${id}`);
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  const panel = page.getByRole("dialog", { name: "Add to Groceries" });

  await expect(panel.getByRole("checkbox", { name: "zout" })).toBeChecked();
  await expect(panel.getByRole("checkbox", { name: "peper" })).toBeChecked();
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel).toBeHidden();

  await page.goto("/groceries");
  await expect(page.locator('[data-grocery-name="zout"]')).toHaveCount(1);
  await expect(page.locator('[data-grocery-name="peper"]')).toHaveCount(1);
  await expect(page.locator('[data-grocery-name="zout en peper"]')).toHaveCount(0);
});
