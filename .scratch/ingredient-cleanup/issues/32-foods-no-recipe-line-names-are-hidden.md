# 32: Foods no recipe line names are hidden, and AI leaves them alone

**What to build:** Found by ticket 12. AI deleted "Nora reserve eten", an own food only a grocery names, as not a food, and the grocery lost its aisle and price (ticket 25). Mike, 2026-10-21: a food no recipe line names is not an ingredient, but its aisle and price are still needed. It stays in the catalogue, hidden.

- **Hidden:** an own food no recipe line names: one only a grocery, recurring grocery or Pantry Ingredient names, or one nothing names (until the 90-day sweep removes it). Read from the rows, not stored: once a recipe line names it, it shows again.
- **The Ingredients page** lists only foods that are not hidden. A filter shows the hidden ones.
- **AI never asks about a hidden food**: no merge, parent, split or deletion. It keeps its aisle and price.
- On the production copy after the first start: 7 own foods are named only by a grocery, 75 by nothing.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] A food only a grocery names is not on the Ingredients page; the filter shows it.
- [ ] AI does not ask about it, and its grocery keeps its aisle and price.
- [ ] Once a recipe line names it, it is listed and AI may ask about it.
- [ ] All `CONTRIBUTING.md` gates pass, including a browser check of the filter.
