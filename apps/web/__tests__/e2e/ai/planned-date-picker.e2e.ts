/**
 * Moving a planned recipe to another day with the date picker in its panel,
 * with a mouse and with a finger. The picker is HeroUI's DatePicker over React
 * Aria; nothing else in the suite opens its calendar, and their minors change
 * it without a type error.
 */
import type { Locator } from "@playwright/test";

import { seedRecipe } from "./cookbooks-support";
import { withDatabase } from "./database";
import { expect, test } from "./fixture";

/** The day of the month the recipe is planned on, as stored. */
function plannedDay(recipeId: string): Promise<number | undefined> {
  return withDatabase(async (database) => {
    const result = await database.query<{ day: number }>(
      `select extract(day from date)::int as day from planned_items where recipe_id = $1`,
      [recipeId]
    );

    return result.rows[0]?.day;
  });
}

/** Plans the recipe as the owner's dinner today, in the browser's own calendar. */
async function planForTonight(recipeId: string): Promise<void> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  await withDatabase((database) =>
    database.query(
      `insert into planned_items (user_id, date, slot, item_type, recipe_id)
       select user_id, $2, 'Dinner', 'recipe', id from recipes where id = $1`,
      [recipeId, today]
    )
  );
}

for (const pointer of ["mouse", "touch"] as const) {
  test(`a planned recipe moves to another day through its date picker with a ${pointer}`, async ({
    browser,
    aiStack,
  }) => {
    const name = `Picker Stew ${pointer} ${Date.now()}`;

    const recipeId = await seedRecipe(name);

    await planForTonight(recipeId);
    const context = await browser.newContext({
      baseURL: aiStack.baseURL,
      storageState: { cookies: aiStack.ownerCookies, origins: [] },
      viewport: pointer === "touch" ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      hasTouch: pointer === "touch",
    });
    const page = await context.newPage();
    const press = (target: Locator) => (pointer === "touch" ? target.tap() : target.click());

    try {
      await page.goto("/calendar");
      await press(page.getByText(name).first());
      const panel = page.getByRole("dialog");
      const day = panel.getByRole("spinbutton", { name: /day/i });

      await expect(day).toBeVisible();
      const target = Number(await day.getAttribute("aria-valuenow")) === 1 ? 2 : 1;

      await press(panel.getByRole("group").getByRole("button").first());
      const calendar = page.getByRole("grid");

      await expect(calendar).toBeVisible();
      await press(calendar.getByRole("button", { name: new RegExp(`\\b${target}\\b`) }).first());
      await expect(calendar).toBeHidden();
      await expect(day).toHaveAttribute("aria-valuenow", String(target));
      await press(panel.getByRole("button", { name: "Save" }));
      await expect(panel).toBeHidden();
      await expect.poll(() => plannedDay(recipeId)).toBe(target);
    } finally {
      await context.close();
    }
  });
}
