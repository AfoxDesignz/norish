/**
 * Opening a recipe from its card carries the card's image into the recipe's
 * hero with a view transition, which a reader who prefers reduced motion does
 * not see. Either way the recipe page arrives whole: its title, and its hero
 * image loaded, with nothing thrown on the way.
 */
import path from "node:path";

import { seedRecipe } from "./cookbooks-support";
import { expect, test } from "./fixture";
import { seedRecipePhoto } from "./image-generation-support";

const PHOTO = path.join(import.meta.dirname, "fixtures", "supplied-photo.jpg");

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`a recipe opened from its card arrives intact (${reducedMotion})`, async ({
    browser,
    aiStack,
  }) => {
    const name = `Carried Stew ${reducedMotion}`;
    const id = await seedRecipe(name);

    await seedRecipePhoto({
      recipeName: name,
      uploadsDir: aiStack.server.uploadsDir,
      photoPath: PHOTO,
      dishColor: "#884422",
    });

    const context = await browser.newContext({
      baseURL: aiStack.baseURL,
      storageState: { cookies: aiStack.ownerCookies, origins: [] },
      reducedMotion,
    });
    const page = await context.newPage();
    const thrown: string[] = [];

    page.on("pageerror", (error) =>
      thrown.push(`${new URL(page.url()).pathname}: ${error.message.slice(0, 60)}`)
    );

    try {
      await page.goto("/");
      const card = page.getByRole("heading", { name, exact: true, level: 3 });

      await expect(card).toBeVisible();
      await card.click();

      await expect(page).toHaveURL(new RegExp(`/recipes/${id}(\\?|$)`));
      await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();

      const hero = page.locator(`img[src*="/recipes/${id}/"]`).first();

      await expect(hero).toBeVisible();
      await expect
        .poll(() => hero.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      expect(thrown).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
