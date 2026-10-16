# 07: The Ingredient Catalogue on the page, and the cleanup

**What to build:** the Ingredient Catalogue is the seeded foods plus those a recipe line names, read from what points at them and never stored. See the spec, item 6, and the glossary entry.

- The Ingredients page shows recipe-named and flagged foods by default, and **Show all** adds the seed.
- A food only groceries, recurring groceries or the Pantry name is kept, because its aisle and product memory is keyed by it, but the page never lists, finds or counts it, and no round asks about it.
- A scheduled cleanup deletes a non-catalogue food nothing names and nothing is remembered about.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] **Listing.**
  - `ingredients.list` takes the view: default or all.
  - Default: a food some `recipe_ingredients` line names through an alias (or a Compound Spelling part, once 04 lands), plus flagged foods in the catalogue.
  - All: also every seeded food.
  - Search obeys the same set. Check the query plan on the dev data (6k foods, 71k aliases).
- [ ] **Out of the catalogue everywhere else.**
  - The flagged count, Fix catalogue's scopes and counts (`listReviewableIngredients`), and Clean names skip non-catalogue foods.
  - The ingredient picker (merge/move targets, Pantry pick) keeps finding them, so a person can still merge a grocery word into a food.
- [ ] **Cleanup.**
  - Runs beside `old-groceries-cleanup` on the same schedule, and once at boot after the upgrade.
  - Deletes a food that has no `off_id`, no reference (recipe line, grocery, recurring grocery, Pantry Ingredient, Compound Spelling part), no Product Link, Aisle Link or store preference, and no children.
  - Nothing else checks a person's decisions: a food nobody uses and nothing remembers costs nothing to mint again.
  - It announces the deletions.
- [ ] **Tests:**
  - the default and all listings;
  - search;
  - counts and round scopes skipping grocery-only foods;
  - the cleanup deleting and keeping the right foods.

## Comments
