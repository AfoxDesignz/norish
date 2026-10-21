# 25: Grocery foods are hidden, and AI leaves them alone

**What to build:** Found by ticket 12. AI deleted "Nora reserve eten", a grocery food, as not a food, and the grocery lost its aisle and price. Mike, 2026-10-21: a grocery food is no ingredient, but its aisle and price are still needed, so it stays in the catalogue, hidden.

- **A grocery food** is an own food only groceries name: a Grocery, a recurring grocery or a Pantry Ingredient, and no recipe line. An own food nothing names is hidden the same way, until the 90-day sweep removes it. Read from the rows, not stored: once a recipe line names it, it is listed again.
- **Every other food is listed as today**: the seeded foods, so also a grocery on a seeded food ("melk" on milk), and every food a recipe line names.
- **The Ingredients page** never lists a hidden food, search included. There is no way to show them.
- **AI never asks about a hidden food**: no merge, parent, split or deletion. It keeps its aisle and price.
- On the production copy after the first start: 7 grocery foods, 75 own foods nothing names.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] A grocery food is not on the Ingredients page, not even by search, and its grocery keeps its aisle and price.
- [ ] AI does not ask about it.
- [ ] Once a recipe line names it, it is listed and AI may ask about it.
- [ ] All `CONTRIBUTING.md` gates pass, including a browser check of the page.
