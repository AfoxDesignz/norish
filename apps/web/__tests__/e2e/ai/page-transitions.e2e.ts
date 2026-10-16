// Every link navigation is a view transition, back links typed `nav-back`; browser back renders at
// once (React's choice, so the browser restores scroll). Signing in or up is typed `sign-in`.
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

import { enableRegistration } from "./admin-users-support";
import { seedCookbook, seedRecipe } from "./cookbooks-support";
import { expect, OWNER, test } from "./fixture";
import { seedRecipePhoto } from "./image-generation-support";

const PHOTO = path.join(import.meta.dirname, "fixtures", "supplied-photo.jpg");
const PHONE_VIEWPORT = { width: 390, height: 844 };
// The auth screen lifts away, the app rises in, and the wordmark moves into the navbar.
const SIGN_IN_HANDOVER = {
  types: ["sign-in"],
  animations: expect.arrayContaining([
    "::view-transition-old(auth-screen) vt-auth-leave",
    "::view-transition-new(app) vt-app-arrive",
  ]),
};

/** A view transition: its types, and what animates once it is ready, as `<layer> <animation>`. */
type Recorded = { types: string[]; animations: string[] };

/** Records every view transition the page runs, same-document or not. */
async function recordViewTransitions(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen: { types: string[]; animations: string[] }[] = [];
    // React names a page's ViewTransition itself, so those layers read as `page`.
    const animations = () =>
      document
        .getAnimations()
        .flatMap((animation) => {
          const layer = (animation.effect as KeyframeEffect | null)?.pseudoElement;

          if (!(animation instanceof CSSAnimation) || !layer?.startsWith("::view-transition")) {
            return [];
          }

          return [`${layer.replace(/\(_[^)]*\)/, "(page)")} ${animation.animationName}`];
        })
        .sort((a, b) => a.localeCompare(b));
    const record = (transition: ViewTransition) =>
      transition.ready.then(
        () => seen.push({ types: [...transition.types], animations: animations() }),
        () => {}
      );
    const start = document.startViewTransition.bind(document);

    Object.assign(window, { __viewTransitions: seen });
    document.startViewTransition = (
      update?: StartViewTransitionOptions | ViewTransitionUpdateCallback
    ) => {
      const transition = start(update);

      void record(transition);

      return transition;
    };
    // Runs before the root layout's own listener, which adds the types; `ready`
    // settles after both.
    addEventListener("pagereveal", (event) => {
      if (event.viewTransition) void record(event.viewTransition);
    });
  });
}

function viewTransitions(page: Page): Promise<Recorded[]> {
  return page.evaluate(
    () => (window as unknown as { __viewTransitions: Recorded[] }).__viewTransitions
  );
}

async function viewTransitionTypes(page: Page): Promise<string[][]> {
  return (await viewTransitions(page)).map((transition) => transition.types);
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`a recipe slides in from its card and out through its back link, its colour fading in place (${reducedMotion})`, async ({
    browser,
    aiStack,
  }) => {
    const name = `Tinted Stew ${reducedMotion}`;
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

    await recordViewTransitions(context);
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
      // The dish colour's underlay fades in where it stands.
      await expect(page.locator("[data-dish-tint] > [aria-hidden]")).toHaveCSS(
        "animation-name",
        reducedMotion === "reduce" ? "none" : "fade-in"
      );

      await page.getByRole("link", { name: "Back to library" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(card).toBeVisible();

      // A history step renders at once, and the recipe arrives intact.
      await page.goBack();
      await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();

      await expect.poll(() => viewTransitionTypes(page)).toEqual([[], ["nav-back"]]);
      const [opening, leaving] = await viewTransitions(page);

      if (reducedMotion === "reduce") {
        expect([opening!.animations, leaving!.animations]).toEqual([[], []]);
      } else {
        // Only the page slides: nothing else cross-fades, and the colour fades out in place.
        expect(opening!.animations).toEqual(["::view-transition-new(page) vt-in"]);
        expect(leaving!.animations).toEqual([
          "::view-transition-new(page) vt-in",
          "::view-transition-old(recipe-tint) -ua-view-transition-fade-out",
        ]);
      }

      expect(thrown).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("moving from a recipe to its editor slides the page", async ({ page }) => {
  const id = await seedRecipe("Sliding Stew");

  await recordViewTransitions(page.context());
  await page.goto(`/recipes/${id}`);
  await page.getByRole("button", { name: "Actions" }).first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/edit/${id}$`));

  await expect
    .poll(() => viewTransitions(page))
    .toEqual([
      expect.objectContaining({ types: [], animations: ["::view-transition-new(page) vt-in"] }),
    ]);
});

test("a tab starts its page at the top, and a step back returns the page to where it was left, the nav shown on both", async ({
  browser,
  aiStack,
}) => {
  const context = await browser.newContext({
    baseURL: aiStack.baseURL,
    storageState: { cookies: aiStack.ownerCookies, origins: [] },
    viewport: PHONE_VIEWPORT,
  });
  const page = await context.newPage();
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  // The phone's nav bar shrinks while the reader scrolls down a page.
  const nav = page.locator("div.fixed", { has: page.getByRole("link", { name: "Groceries" }) });
  const SHRUNKEN = /^matrix\(0\.8, /;

  try {
    await page.goto("/settings?tab=user");
    await expect(page.getByRole("tab", { name: "User" })).toBeVisible();
    // The nav ignores scrolling for a moment after a page arrives, so the way
    // down is retried until it reads.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(
        () => new Promise((settled) => requestAnimationFrame(() => requestAnimationFrame(settled)))
      );
      await page.evaluate(() => window.scrollTo(0, 400));
      await expect(nav).toHaveCSS("transform", SHRUNKEN, { timeout: 500 });
    }).toPass();
    await expect.poll(scrollY).toBe(400);

    await page.getByRole("link", { name: "Groceries" }).click();
    await expect(page).toHaveURL(/\/groceries$/);
    await expect.poll(scrollY).toBe(0);
    await expect(nav).toHaveCSS("transform", "none");

    await page.goBack();
    await expect(page).toHaveURL(/\/settings\?tab=user$/);
    await expect.poll(scrollY).toBe(400);
    // Landing where the page was left is not the reader scrolling down.
    await expect(nav).toHaveCSS("transform", "none");
  } finally {
    await context.close();
  }
});

test("going back returns a page to where it was left, and a tab starts it at the top", async ({
  browser,
  aiStack,
}) => {
  // Newest first, so these fill the top of the Library.
  for (let n = 1; n <= 12; n++) await seedRecipe(`Shelf Stew ${n}`);

  const context = await browser.newContext({
    baseURL: aiStack.baseURL,
    storageState: { cookies: aiStack.ownerCookies, origins: [] },
    viewport: { width: 390, height: 640 },
  });

  await recordViewTransitions(context);
  const page = await context.newPage();
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const tab = (name: string) => page.getByRole("link", { name, exact: true }).click();

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Shelf Stew 12", level: 3 })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect.poll(scrollY).toBe(700);

    // A card fully on screen, clear of the header and the nav bar.
    const name = await page.getByRole("heading", { level: 3, name: /^Shelf Stew / }).evaluateAll(
      (headings) =>
        headings.find((heading) => {
          const box = heading.getBoundingClientRect();

          return box.top > 100 && box.bottom < window.innerHeight - 120;
        })?.textContent
    );

    if (!name) throw new Error("No Shelf Stew card is on screen at 700px.");
    await page.getByRole("heading", { level: 3, name, exact: true }).click();
    await expect(page).toHaveURL(/\/recipes\//);
    await expect.poll(scrollY).toBe(0);

    await page.evaluate(() => window.scrollTo(0, 200));
    await expect.poll(scrollY).toBe(200);
    await tab("Groceries");
    await expect(page).toHaveURL(/\/groceries$/);
    await expect.poll(scrollY).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/recipes\//);
    await expect.poll(scrollY).toBe(200);

    await page.getByRole("link", { name: "Back to library" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(scrollY).toBe(700);

    await tab("Groceries");
    await expect(page).toHaveURL(/\/groceries$/);
    await tab("Recipes");
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(scrollY).toBe(0);

    await expect
      .poll(() => viewTransitionTypes(page))
      .toEqual([[], [], ["nav-back"], [], ["nav-back"]]);
  } finally {
    await context.close();
  }
});

test("a back link returns a recipe to where it was scrolled", async ({ page }) => {
  const name = "Scrolled Stew";
  const id = await seedRecipe(name);
  const shelf = "Stew Shelf";

  await seedCookbook(shelf, [id]);
  await page.setViewportSize({ width: 390, height: 500 });
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));

  await page.goto(`/recipes/${id}`);
  // The recipe's cookbooks come last on its page.
  const cookbook = page.getByRole("link", { name: shelf }).filter({ visible: true });

  await cookbook.scrollIntoViewIfNeeded();
  const left = await scrollY();

  expect(left).toBeGreaterThan(0);
  await cookbook.click();
  await expect(page).toHaveURL(/\/cookbooks\//);
  await expect.poll(scrollY).toBe(0);

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${id}$`));
  await expect.poll(scrollY).toBe(left);
});

test("signing in hands the auth screen over to the app in one transition", async ({
  browser,
  aiStack,
}) => {
  const context = await browser.newContext({ baseURL: aiStack.baseURL });

  await recordViewTransitions(context);
  const page = await context.newPage();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Your library" })).toBeVisible();
    await expect.poll(() => viewTransitions(page)).toEqual([SIGN_IN_HANDOVER]);
  } finally {
    await context.close();
  }
});

test("creating an account hands the auth screen over to the app in the same transition", async ({
  browser,
  aiStack,
}) => {
  await enableRegistration();
  const context = await browser.newContext({ baseURL: aiStack.baseURL });

  await recordViewTransitions(context);
  const page = await context.newPage();

  try {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Signup Transition");
    await page.getByLabel("Email").fill(`signup-transition-${Date.now()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("signup-transition-password");
    await page.getByLabel("Confirm Password").fill("signup-transition-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).not.toHaveURL(/\/signup/, { timeout: 15_000 });
    await expect.poll(() => viewTransitions(page)).toEqual([SIGN_IN_HANDOVER]);
  } finally {
    await context.close();
  }
});
