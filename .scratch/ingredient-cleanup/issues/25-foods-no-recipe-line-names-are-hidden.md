# 25: Foods no recipe line names are hidden, and AI leaves them alone

**What to build:** Found by ticket 12. AI deleted "Nora reserve eten", an own food only a grocery names, as not a food, and the grocery lost its aisle and price. Mike, 2026-10-21: a food no recipe line names is no ingredient, but its aisle and price are still needed, so it stays in the catalogue, hidden.

- **Hidden:** an own food no recipe line names: one only a grocery, recurring grocery or Pantry Ingredient names, or one nothing names (until the 90-day sweep removes it). Read from the rows, not stored: once a recipe line names it, it is listed again. Seeded foods are listed as today.
- **The Ingredients page** never lists a hidden food, search included. There is no way to show them.
- **AI never asks about a hidden food**: no merge, parent, split or deletion. It keeps its aisle and price.
- On the production copy after the first start: 7 own foods are named only by a grocery, 75 by nothing, none only by a Pantry Ingredient.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] A food only a grocery names is not on the Ingredients page, not even by search, and its grocery keeps its aisle and price.
- [ ] AI does not ask about it.
- [ ] Once a recipe line names it, it is listed and AI may ask about it.
- [ ] All `CONTRIBUTING.md` gates pass, including a browser check of the page.
