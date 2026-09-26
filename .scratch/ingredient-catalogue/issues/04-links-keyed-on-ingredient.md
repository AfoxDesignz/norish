# 04: Product Links, Aisle Links and store preferences keyed on the Ingredient

**What to build:** A Product Link, an Aisle Link and a store preference become facts about an Ingredient at a Store (for the preference, per user), no longer about a folded name. Filing "onion" in an Aisle files "onions, diced" and "uien" there too. A Product Link made for "onion" prices every alias of it, and a store preference for "milk" holds for "melk". A migration carries every existing link and preference over to the Ingredient whose alias has its fold. On a collision the most recently updated one wins. A fold that no alias matches mints an Ingredient, so no link is dropped. Store lookup, Decision suggestions and Line Cost read the link through the grocery's alias.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Product Links, Aisle Links and store preferences are unique on (store, Ingredient), or (user, Ingredient) for preferences.
- [ ] Every writer and reader of these links goes through the Ingredient: grocery create, rename and move, store lookup, the aisle picker, and the preference writes on groceries and recurring groceries.
- [ ] Migration tests cover carry-over, collisions and unmatched folds.
- [ ] The existing grocery-prices, grocery-aisles and ingredient-linking E2E specs pass.
- [ ] CONTEXT.md's Product Link, Aisle Link and Grocery entries are rewritten around the Ingredient. ADR-0031 is amended.
