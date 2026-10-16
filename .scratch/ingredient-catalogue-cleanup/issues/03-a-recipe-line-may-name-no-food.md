# 03: A recipe line may name no food

**What to build:** AI gets a fourth answer, "names no food". When it is sure for a mint that only recipe lines name, the lines point at nothing, as a heading does, and the mint is removed. The line keeps its text, amount and unit (`recipe_ingredients.name`), so "Winston55" still reads "Winston55". See the spec, item 3, and the Ingredient Alias entry in `CONTEXT.md`.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] **Asking.** The `ingredient-resolution` Prompt and the Decision options gain the answer, and its schema gains the verdict.
  - Neither the Prompt nor the Decision may offer the answer for a food that a Grocery, a recurring grocery or a Pantry Ingredient names. Anything on a list is something you buy.
- [ ] **Applying.** Clear `ingredient_alias_id` on the lines, delete the mint and its aliases, and announce the change to the recipes' readers.
- [ ] **What reads a line without a food** must already cope, since a heading has none. Check:
  - adding a recipe to the groceries (the text still goes on the list);
  - Pantry coverage;
  - nutrition's left-out list;
  - icons;
  - Step Ingredients.
- [ ] **Tests:**
  - a sure answer clears the lines and removes the mint;
  - an unsure one leaves the flag;
  - a grocery-named mint is never asked about it;
  - the recipe reads unchanged.

## Comments
