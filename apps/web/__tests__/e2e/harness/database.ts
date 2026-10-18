import { Client } from "pg";

/**
 * Run one unit of work against the stack's database and close the
 * connection whatever happens. Scenarios read server truth this way — a row's
 * version, a household's join code — rather than through the app.
 */
export async function withDatabase<T>(
  databaseUrl: string,
  run: (database: Client) => Promise<T>
): Promise<T> {
  const database = new Client({ connectionString: databaseUrl });

  await database.connect();

  try {
    return await run(database);
  } finally {
    await database.end();
  }
}

/** Insert a recipe line naming one food, as the app writes it: the line, then its food at position 0. */
export async function insertRecipeLine(
  database: Client,
  line: {
    recipeId: string;
    name: string;
    aliasId: string;
    order: number;
    amount?: number | null;
    unit?: string | null;
  }
): Promise<void> {
  await database.query(
    `with line as (
       insert into recipe_ingredients (recipe_id, name, amount, unit, "order", system_used)
       values ($1, $2, $4, $5, $6, 'metric') returning id)
     insert into recipe_ingredient_foods (recipe_ingredient_id, position, ingredient_alias_id)
     select id, 0, $3::uuid from line`,
    [line.recipeId, line.name, line.aliasId, line.amount ?? null, line.unit ?? null, line.order]
  );
}
