# 10: Open Food Facts seed

**What to build:** The catalogue is seeded from the Open Food Facts ingredients taxonomy: every entry, additives included, with names in every language and parent links. The pieces:
- **Parser:** a pure function that turns the file into entries.
- **Apply step:** upserts only seeded Ingredients, seeded aliases (with their locale) and seeded parents. It never touches owned rows, owned aliases, merges or user-set parents. An entry the file no longer lists is kept while anything points at it. A seeded alias already held by another Ingredient stays where it is, and the collision is logged.
- **Nightly fetch:** a new scheduled task on the midnight cron fetches the file with a conditional request, and first boot enqueues a fetch at once. The whole file is validated before anything is applied. A failure keeps the last good seed and shows in the job monitor through the instrumented processor.
- **Source URL:** one env var, defaulting to the taxonomy on Open Food Facts' GitHub.
- **Backfill:** once a seed is applied, existing Ingredients are run through the full resolution order once, merging where sure and flagging where not.
- **ODbL duties:** a **Data sources** page with the Open Food Facts credit and an ODbL link, and a JSON download of Ingredients, aliases and parents for any signed-in user.

**Blocked by:** 06, 09

**Status:** ready-for-agent

- [ ] Parser tests use a fixture excerpt of the taxonomy file.
- [ ] Apply tests run against the database: owned rows untouched, dropped-but-referenced entries kept, alias collision logged, and a malformed file applies nothing.
- [ ] The scheduled-tasks producer test asserts the new task is registered, and the worker is wrapped in the instrumented processor.
- [ ] The env var is in `.env.example`, a configuration page and the Upgrade notes.
- [ ] The backfill merges a pre-existing "onions" into the seeded "onion" and runs once.
- [ ] The Data sources page and the export work.
- [ ] An ADR records *the catalogue is seeded from Open Food Facts under ODbL*.
