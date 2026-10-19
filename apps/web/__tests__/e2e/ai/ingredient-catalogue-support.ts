import type { AIE2EStack } from "./fixture";
import { callTrpc, queryTrpc } from "../harness/trpc";
import { withDatabase } from "./database";
import { expect } from "./fixture";

/** One food the scenario's catalogue knows, with its spellings and their languages. */
export interface SeededFood {
  name: string;
  aliases: Array<{ text: string; locale: string | null }>;
  flagged?: boolean;
}

/**
 * The state this scenario reads: its recipes, groceries and Ingredients (a
 * Pantry Ingredient, an Aisle Link and an alias go with their Ingredient).
 * Run before seeding, so the scenario answers for what it put there and not
 * for whatever spec ran before it, exactly as the pantry scenario does.
 */
export function resetCatalogueScenario(): Promise<void> {
  return withDatabase(async (database) => {
    await database.query("delete from recipes");
    await database.query("delete from groceries");
    await database.query("delete from recurring_groceries");
    await database.query("delete from ingredients");
  });
}

/**
 * A small catalogue of the scenario's own, written the way the seed writes
 * one, instead of fetching Open Food Facts: nothing outbound is involved.
 * The foods belong to the first account, so it may edit them. The scenario's
 * spellings are plain lowercase words, so their fold is their lowercase self.
 */
export function seedCatalogue(foods: readonly SeededFood[]): Promise<Record<string, string>> {
  return withDatabase(async (database) => {
    const owner = (
      await database.query<{ id: string }>(`select id from "user" order by "createdAt" asc limit 1`)
    ).rows[0];

    if (!owner) throw new Error("The harness has provisioned no accounts");

    const ids: Record<string, string> = {};

    for (const food of foods) {
      const ingredient = await database.query<{ id: string }>(
        `insert into ingredients (name, owner_id, flagged) values ($1, $2, $3) returning id`,
        [food.name, owner.id, food.flagged ?? false]
      );

      ids[food.name] = ingredient.rows[0]!.id;

      for (const alias of food.aliases) {
        await database.query(
          `insert into ingredient_aliases (text, fold, locale, ingredient_id, seeded)
           values ($1, lower($1), $2, $3, true)`,
          [alias.text, alias.locale, ids[food.name]]
        );
      }
    }

    return ids;
  });
}

/** A plain Store with one aisle, and one Ingredient filed in it. */
export function seedStoreFiling(
  storeName: string,
  aisleName: string,
  ingredientId: string
): Promise<void> {
  return withDatabase(async (database) => {
    const owner = (
      await database.query<{ id: string }>(`select id from "user" order by "createdAt" asc limit 1`)
    ).rows[0];

    if (!owner) throw new Error("The harness has provisioned no accounts");
    await database.query(`delete from stores where name = $1`, [storeName]);

    const store = await database.query<{ id: string }>(
      `insert into stores (user_id, name) values ($1, $2) returning id`,
      [owner.id, storeName]
    );
    const aisle = await database.query<{ id: string }>(
      `insert into aisles (store_id, name, sort_order) values ($1, $2, 0) returning id`,
      [store.rows[0]!.id, aisleName]
    );

    await database.query(
      `insert into aisle_links (store_id, ingredient_id, aisle_id) values ($1, $2, $3)`,
      [store.rows[0]!.id, ingredientId, aisle.rows[0]!.id]
    );
  });
}

/** The Ingredient a spelling names now, as the database has it. */
export function readIngredientOf(spelling: string): Promise<string | null> {
  return withDatabase(async (database) => {
    const rows = await database.query<{ name: string }>(
      `select i.name from ingredient_aliases a join ingredients i on i.id = a.ingredient_id
        where a.fold = lower($1)`,
      [spelling]
    );

    return rows.rows[0]?.name ?? null;
  });
}

/** Place one Ingredient under another, as a person would on the Ingredients page. */
export function setParent(childId: string, parentId: string): Promise<void> {
  return withDatabase(async (database) => {
    await database.query(
      `update ingredients set parent_id = $1, parent_chosen = true where id = $2`,
      [parentId, childId]
    );
  });
}

/** A recipe with these amount-less lines, saved through tRPC as the recipe form saves one; its id. */
export function createRecipe(
  stack: Pick<AIE2EStack, "baseURL" | "ownerCookies">,
  name: string,
  lines: readonly string[]
): Promise<string> {
  return callTrpc<string>(stack.baseURL, stack.ownerCookies, "recipes.create", {
    name,
    systemUsed: "metric",
    servings: 2,
    recipeIngredients: lines.map((ingredientName, order) => ({
      ingredientName,
      ingredientId: null,
      amount: null,
      unit: null,
      order,
    })),
    steps: [],
    tags: [],
    cuisines: [],
    categories: [],
    images: [],
    videos: [],
  });
}

/** Wait until no AI pass is queued or running, so none takes the ingredient answers queued next. */
export async function waitForAIPasses(stack: Pick<AIE2EStack, "baseURL" | "ownerCookies">) {
  await expect
    .poll(
      () =>
        queryTrpc<unknown[]>(stack.baseURL, stack.ownerCookies, "admin.jobs.list", {
          queue: "ingredient-review",
          states: ["waiting", "active", "delayed"],
          limit: 1,
        }),
      { timeout: 60_000 }
    )
    .toEqual([]);
}
