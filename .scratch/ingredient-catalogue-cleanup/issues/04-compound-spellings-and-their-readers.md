# 04: Compound Spellings and what reads them

**What to build:** an Ingredient Alias may name several Ingredients, in order, "and" or "or" (ADR-0040). Lines keep their one alias; every reader of a line's food handles several. This ticket is the model, the readers and the person's split. Ticket 05 is detection.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] **Schema.** A compound alias names its foods in order with a kind (`and`/`or`).
  - Pick the smallest shape that keeps `ingredient_aliases.ingredient_id` meaningful: the first food, for every reader that wants one, plus a parts table.
  - Explain the pick in Comments.
  - Merges, moves and the seed must keep parts pointing at live Ingredients. A merge re-points parts like everything else; deleting a food that is a part refuses, as an in-use food does.
- [ ] **Pantry.** Coverage reads every part: an "and" line is stocked when all are kept, an "or" when any is (children of a part count, as today).
- [ ] **Adding a recipe to the groceries.**
  - A compound line becomes one Grocery per part that isn't stocked, each named for its part's spelling as written and holding that part's food.
  - For an "or", every part but the first starts unticked, and the screen says the line is an "or".
- [ ] **A Grocery typed as a Compound Spelling** keeps one Grocery, priced and filed as its first food.
- [ ] **Icon:** the first food's.
- [ ] **Nutrition:** an "or" takes the first food's numbers. An "and" is left out with a new reason, "names several foods", in all locales.
- [ ] **The Ingredient panel** lists a compound spelling among each of its foods' translations, marked with its other foods.
  - Moving it to one food makes it an ordinary spelling of that food. That is the undo for a wrong split.
- [ ] **Split suggestion.** A flagged food may carry a suggestion to split it into named foods with a kind. Confirming turns its spelling(s) into a Compound Spelling and removes the food; dismissing keeps it one food and marks it distinct.
- [ ] **Tests:**
  - Pantry coverage for both kinds;
  - add-to-groceries for both kinds, including the unticked "or" parts;
  - nutrition and icon;
  - merge and move with parts;
  - confirm and dismiss of a split.

## Comments
