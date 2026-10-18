# 11: The browser E2E suite reaches the database through the app, not raw SQL

**What to build:** The browser E2E suite (`apps/web/__tests__/e2e/`) sets up its data and checks results with about 130 raw SQL queries over `pg`, across 28 files: users, recipes, foods, spellings, recipe lines, groceries, the Pantry, cookbooks, server config, and the reads that check what changed. None go through the repository layer, so each schema change means hand-editing SQL in test files. Ticket 03 had to rewrite three copies of the recipe-line insert.

Every E2E read and write goes through the app instead: tRPC as a signed-in reader where the app offers it (`callTrpc` / `queryTrpc` in `harness/trpc.ts`, as the nutrition spec's `lineIngredient` already does), and repository functions where it doesn't, such as backdating a mark or forcing a rung version. Calling repositories from the E2E process means pointing `@norish/db` at each worker's own database before its first use.

**Blocked by:** 01–10, so the suite moves once the data model stops changing.

**Status:** ready-for-agent

- [ ] No E2E file holds raw SQL; `pg` is imported only where the harness wires the repository layer to a worker's database.
- [ ] Each worker's repository calls reach that worker's database and no other.
- [ ] All E2E suites stay green, and all `CONTRIBUTING.md` gates pass.
