# 06: Renaming onto a taken name

**What to build:** when a person saves a rename to a name another food holds, as its name or as any spelling, matched by fold, the panel asks one of two things. See the spec, item 5, ADR-0037 (amended 2026-10-16), and the Ingredient Alias entry.

1. **Add as translation:** the merge that exists today. The renamed food's spellings join the other food, and recipes keep reading as written.
2. **Merge:** the same merge, plus the spelling's words replaced with the typed name in the lines of recipes the person may edit and on their household's groceries.
   - "2 uitjes, gesnipperd" becomes "2 ui, gesnipperd".
   - The amount, the unit and the rest of the text stay.
   - Other recipes keep their text. The old spelling stays with the food.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] **Detect the collision by fold, not `lower(name)`.**
  - Today `renameIngredientIn` (`shared-server/src/ingredients/catalogue.ts`) refuses a `lower(name)` clash with `name-taken`.
  - It silently skips the alias when only a spelling clashes.
  - Use `findIngredientHolding`, which checks both. The surviving food keeps its own name, parent and icon.
- [ ] **The panel's Save** opens the two-choice dialog instead of the error toast, keeping the rest of the draft.
- [ ] **The rewrite.**
  - Replace the words the line's spelling matched inside `recipe_ingredients.name` for recipes the actor may edit (the recipe permission policy), and the same inside grocery names in the actor's household.
  - One transaction with the merge.
  - The rewritten lines then resolve as written (rung 1 hits the typed name's alias).
- [ ] **The Merge button** (`ingredient-relocation.tsx`) only adds as translation. Its copy (`mergeTitle`, `mergedToast`) says the two "become one food", not "a translation of", in all locales.
- [ ] **Permission.**
  - Any merge, a person's or a confirmed suggestion, needs edit rights on the disappearing food only (`mergeIngredients` in `catalogue.ts`), since the survivor only gains spellings.
  - This fixes non-admins seeing merge suggestions into a seeded food that they then cannot confirm.
- [ ] **Tests:**
  - collision by name and by spelling;
  - both choices;
  - the rewrite only in editable recipes;
  - the surviving food's name;
  - merge permission on the source only.

## Comments
