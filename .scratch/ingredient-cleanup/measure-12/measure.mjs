/**
 * Ticket 12: the same counts from a 0.25.1 or a 0.26 database, read-only.
 *   node measure.mjs <database url> [redis url] [private dir] > run.json
 *   node measure.mjs compare <label>=<run.json> ... > table.md
 * The private dir gets the named cases' line texts (production text, kept out of the repo).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(join(root, "packages/db/package.json"));

// The spec's named cases, each with the texts it is looked up by (production writes some otherwise).
const CASES = {
  "gyoza vellen": ["gyoza vellen", "gyoza vellen )", "gyoza vellen ((ontdooid))"],
  "3wu)": ["3wu)"],
  "paprika (vrucht)": ["paprika (vrucht)"],
  "zout en peper": ["zout en peper"],
  "boter of olie": ["boter of olie"],
  "water of kokosmelk": ["water of kokosmelk"],
  "juice of a lemon": ["juice of"],
  "mac and cheese": ["mac and cheese"],
  "toilet paper": ["toilet paper", "toiletpapier"],
  deegroller: ["deegroller"],
  melted: ["melted"],
  "Voor de salade:": ["Voor de salade:"],
  "taart- of springvorm": ["taart- of springvorm", "taart- of springvorm (doorsnede 26 cm)"],
};

if (process.argv[2] === "compare") compare(process.argv.slice(3));
else await measure(process.argv[2], process.argv[3], process.argv[4]);

async function measure(databaseUrl, redisUrl, privateDir) {
  const { Client } = require("pg");
  const db = new Client({ connectionString: databaseUrl });

  await db.connect();
  // Nothing here writes; the transaction makes sure of it.
  await db.query("begin read only");
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params) => Object.values((await rows(sql, params))[0])[0];
  // Every tally query answers `k, n`.
  const tally = async (sql) => Object.fromEntries((await rows(sql)).map((r) => [r.k, r.n]));
  const hasTable = async (name) =>
    (await scalar("select to_regclass($1) is not null", [name])) === true;

  const lineFoods = (await hasTable("recipe_ingredient_foods"))
    ? `select ri.id, ri.name, ri.joined::text as joined, f.position, a.ingredient_id, a.text as spelling
         from recipe_ingredients ri
         left join recipe_ingredient_foods f on f.recipe_ingredient_id = ri.id
         left join ingredient_aliases a on a.id = f.ingredient_alias_id`
    : `select ri.id, ri.name, null::text as joined, 0 as position, a.ingredient_id, a.text as spelling
         from recipe_ingredients ri left join ingredient_aliases a on a.id = ri.ingredient_alias_id`;
  const words = JSON.parse(
    readFileSync(join(root, "packages/config/src/ingredient-words.default.json"), "utf8")
  );
  const joining = [
    ...new Set(
      Object.values(words).flatMap((w) => [...(w.together ?? []), ...(w.alternatives ?? [])])
    ),
  ];

  const counts = {
    ingredients: {
      all: await scalar("select count(*)::int from ingredients"),
      own: await scalar("select count(*)::int from ingredients where off_id is null"),
      seeded: await scalar("select count(*)::int from ingredients where off_id is not null"),
      flagged: await scalar("select count(*)::int from ingredients where flagged"),
      keptDistinct: await scalar("select count(*)::int from ingredients where kept_distinct"),
      withParent: await scalar("select count(*)::int from ingredients where parent_id is not null"),
      ownWithParent: await scalar(
        "select count(*)::int from ingredients where off_id is null and parent_id is not null"
      ),
    },
    flaggedBy: await tally(
      "select coalesce(flag_reason, '(none)') as k, count(*)::int as n from ingredients where flagged group by 1 order by 2 desc"
    ),
    spellings: {
      all: await scalar("select count(*)::int from ingredient_aliases"),
      own: await scalar("select count(*)::int from ingredient_aliases where not seeded"),
    },
    lines:
      await tally(`with l as (select id, name, max(joined) as joined, count(ingredient_id) as foods from (${lineFoods}) x group by id, name)
          select case when name like '#%' then 'heading'
                      when name ~ ':\\s*$' and foods > 0 then 'colon line, with a food'
                      when foods = 0 then 'no food'
                      when foods = 1 then 'one food'
                      else 'several, ' || coalesce(joined, 'unjoined') end as k, count(*)::int as n
          from l group by 1 order by 1`),
    noFood: {
      groceries: await scalar(
        "select count(*)::int from groceries where ingredient_alias_id is null"
      ),
      recurringGroceries: await scalar(
        "select count(*)::int from recurring_groceries where ingredient_alias_id is null"
      ),
      pantryIngredients: await scalar(
        "select count(*)::int from pantry_ingredients where ingredient_alias_id is null"
      ),
    },
    rows: {
      lines: await scalar("select count(*)::int from recipe_ingredients"),
      groceries: await scalar("select count(*)::int from groceries"),
      recurringGroceries: await scalar("select count(*)::int from recurring_groceries"),
      pantryIngredients: await scalar("select count(*)::int from pantry_ingredients"),
    },
    // By this release's joining words in every language, so all four runs are read alike.
    joinedOwnFoods: await scalar(
      "select count(*)::int from ingredients where off_id is null and lower(name) ~ $1",
      [`\\s(${joining.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s`]
    ),
  };

  if (await hasTable("ingredient_ai_changes")) {
    counts.aiChanges =
      await tally(`select kind || ', ' || case when sure then 'sure' else 'unsure' end as k, count(*)::int as n
      from ingredient_ai_changes group by 1 order by 1`);
  }
  if (await hasTable("ingredient_suggestions")) {
    counts.suggestions = await tally(
      "select kind as k, count(*)::int as n from ingredient_suggestions group by 1 order by 1"
    );
  }

  const named = {};
  const privateLines = {};

  for (const [text, lookups] of Object.entries(CASES)) {
    const exact = lookups.map((t) => t.toLowerCase());
    const lines = await rows(
      `select x.id, x.name, max(x.joined) as joined, array_remove(array_agg(distinct x.spelling), null) as spellings,
              coalesce(string_agg(i.name, ' + ' order by x.position) filter (where i.id is not null), '(no food)') as foods
         from (${lineFoods}) x left join ingredients i on i.id = x.ingredient_id
        where lower(x.name) like any($1) group by x.id, x.name`,
      [exact.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`)]
    );
    // The case's own texts, and the spellings its lines point at (a cleanup may have renamed one).
    const spellings = await rows(
      `select a.text, a.seeded, a.ingredient_id, i.name as food from ingredient_aliases a join ingredients i on i.id = a.ingredient_id
        where lower(a.text) = any($1) or a.text = any($2) order by a.text limit 12`,
      [exact, lines.flatMap((l) => l.spellings)]
    );
    const foods = await rows(
      `select distinct i.name, i.off_id is not null as seeded, i.flagged, i.flag_reason, i.kept_distinct, p.name as parent
        from ingredients i left join ingredients p on p.id = i.parent_id
        where lower(i.name) = any($1) or i.id = any($2::uuid[]) order by i.name limit 12`,
      [exact, spellings.map((sp) => sp.ingredient_id)]
    );
    const byFoods = {};

    for (const line of lines) {
      const key = line.joined ? `${line.foods} (${line.joined})` : line.foods;

      byFoods[key] = (byFoods[key] ?? 0) + 1;
    }
    named[text] = {
      spellings: spellings.map((s) => `${s.text}${s.seeded ? " [seed]" : ""} → ${s.food}`),
      foods: foods.map(
        (f) =>
          `${f.name}${f.seeded ? " [seed]" : ""}${f.flagged ? ` [flag: ${f.flag_reason}]` : ""}${f.kept_distinct ? " [distinct]" : ""}${f.parent ? ` under ${f.parent}` : ""}`
      ),
      lines: lines.length,
      linesBy: byFoods,
    };
    privateLines[text] = lines.map((l) => `${l.name} → ${l.foods}`);
  }

  await db.query("rollback");
  await db.end();

  const ai = redisUrl ? await aiUse(redisUrl) : null;

  if (privateDir)
    writeFileSync(join(privateDir, "named-lines.json"), JSON.stringify(privateLines, null, 2));
  console.log(JSON.stringify({ counts, ai, named }, null, 2));
}

/** Requests and tokens per queue, from every job's progress (the job monitor's Models row). */
async function aiUse(redisUrl) {
  const ioredis = createRequire(join(root, "packages/queue/package.json"))("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  const redis = new Redis(redisUrl);
  const byQueue = {};
  let cursor = "0";

  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "bull:*", "COUNT", 1000);

    cursor = next;
    for (const key of keys) {
      const parts = key.split(":");

      if (parts.length !== 3 || (await redis.type(key)) !== "hash") continue;
      const progress = await redis.hget(key, "progress");

      if (!progress) continue;
      const uses = [];
      const walk = (value) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          if (Array.isArray(value.models)) uses.push(...value.models);
          else Object.values(value).forEach(walk);
        }
      };

      walk(JSON.parse(progress));
      if (uses.length === 0) continue;
      const q = (byQueue[parts[1]] ??= { jobs: 0, requests: 0, failed: 0, tokens: 0, models: {} });

      q.jobs += 1;
      for (const use of uses) {
        q.requests += 1;
        if (use.outcome === "failed") q.failed += 1;
        q.tokens += use.tokens ?? 0;
        const model = `${use.provider} · ${use.model}`;

        q.models[model] = (q.models[model] ?? 0) + 1;
      }
    }
  } while (cursor !== "0");
  await redis.quit();

  return byQueue;
}

function compare(args) {
  const runs = args.map((arg) => {
    const [label, file] = arg.split("=");

    return { label, ...JSON.parse(readFileSync(file, "utf8")) };
  });
  const out = [];
  const table = (title, pick) => {
    const keys = [...new Set(runs.flatMap((r) => Object.keys(pick(r) ?? {})))];

    if (keys.length === 0) return;
    out.push(
      `**${title}**`,
      "",
      `| | ${runs.map((r) => r.label).join(" | ")} |`,
      `|---|${runs.map(() => "---:").join("|")}|`
    );
    for (const key of keys)
      out.push(`| ${key} | ${runs.map((r) => pick(r)?.[key] ?? "–").join(" | ")} |`);
    out.push("");
  };

  table("Ingredients", (r) => r.counts.ingredients);
  table("Flagged, by reason", (r) => r.counts.flaggedBy);
  table("Spellings", (r) => r.counts.spellings);
  table("Recipe lines", (r) => r.counts.lines);
  table("Rows that point at no food", (r) => r.counts.noFood);
  table("Rows", (r) => r.counts.rows);
  table("Joined names still a food of their own", (r) => ({
    "own foods": r.counts.joinedOwnFoods,
  }));
  table("0.25.1 suggestions left", (r) => r.counts.suggestions);
  table("AI Changes", (r) => r.counts.aiChanges);
  for (const queue of [...new Set(runs.flatMap((r) => Object.keys(r.ai ?? {})))]) {
    table(`AI use, ${queue} queue`, (r) => {
      const q = r.ai?.[queue];

      return (
        q && { jobs: q.jobs, requests: q.requests, failed: q.failed, tokens: q.tokens, ...q.models }
      );
    });
  }
  out.push("**Named cases**", "");
  for (const text of Object.keys(runs[0].named)) {
    out.push(`- **"${text}"**`);
    for (const r of runs) {
      const n = r.named[text];
      const lines = Object.entries(n.linesBy)
        .map(([foods, count]) => `${count}× ${foods}`)
        .join("; ");

      out.push(
        `  - ${r.label}: spellings ${n.spellings.join(", ") || "none"}. Foods ${n.foods.join(", ") || "none"}. Lines ${n.lines}${lines ? `: ${lines}` : ""}.`
      );
    }
  }
  console.log(out.join("\n"));
}
