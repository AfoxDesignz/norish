# 03: Prefactor: a recipe line's foods are a list

**What to build:** "Make the change easy" for ticket 04, with no visible change. A recipe line's food moves out of its single alias column into a child table of its own. The table has one row per food, in order, each pointing at an Ingredient Alias. The line gains an empty "joined" field (`together` / `alternatives`, unused until 04). The single column is dropped in the same migration, with no fallback, and every line moves its alias into position 0.

Every reader of a line's food reads the first in order:
- nutrition;
- pantry coverage and the add-to-groceries panel;
- icons;
- the "where used" panel and in-use counts;
- merges and spelling moves;
- deletes;
- the stale-reference retry;
- Recipe Archive export and import;
- offline and realtime payloads.

Deleting an alias deletes its rows. Groceries, recurring groceries and Pantry Ingredients keep their single columns.

See ADR-0037's third 2026-10-17 amendment.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The migration moves every line's alias into the child table at position 0 and drops the old column. Lines with no food (headings) get no row.
- [ ] Recipe pages, nutrition, pantry coverage, add to groceries, icons and the "where used" panel behave exactly as before. The existing tests pass unchanged, apart from fixtures that build lines.
- [ ] A merge and a spelling move carry line foods with them. Deleting an alias leaves its lines with no food.
- [ ] A Recipe Archive round trip keeps every line's food.
- [ ] A database repository test covers the child table's ordering and its cascade on alias delete.
- [ ] All `CONTRIBUTING.md` gates pass, and the E2E suites stay green.
