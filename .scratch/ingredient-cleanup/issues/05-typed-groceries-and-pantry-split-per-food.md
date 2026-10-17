# 05: Typed groceries and pantry entries split per food

**What to build:** A Grocery, a recurring grocery and a Pantry Ingredient name exactly one food. When a person types a text that names several, it becomes one row per food, each with its own part of the text. "zout en peper" typed on the list becomes the groceries "zout" and "peper". Each gets its own aisle, price and store, and each merges with an existing grocery of that food as same-unit adds do today. The same holds when a grocery is renamed to such a text, for a recurring grocery, and for a pantry add. An "or" text ("boter of olie") typed on the list adds its first food. A text that names nothing stays one grocery, pointing at no food (from 01).

See `CONTEXT.md` (Ingredient Alias, Grocery, Pantry Ingredient).

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Typing "zout en peper" adds two groceries with texts "zout" and "peper", each pointing at its food. An offline add splits once it syncs.
- [ ] Renaming a grocery to "zout en peper" leaves two groceries.
- [ ] A recurring grocery "zout en peper" becomes two recurring groceries with the same rule.
- [ ] Adding "zout en peper" to the Pantry adds two Pantry Ingredients.
- [ ] "boter of olie" typed on the list adds "boter".
- [ ] Both new rows announce over realtime like any created grocery, and a second tab converges.
- [ ] Grocery and pantry tests cover the above against a real database. All `CONTRIBUTING.md` gates pass.
