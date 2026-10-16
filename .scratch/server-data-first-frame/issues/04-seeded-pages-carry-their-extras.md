# 04: Seeded pages carry their extras

**What to build:** The pages already seeded stop shifting after load.

- Groceries and the Pantry (`app/(app)/groceries/layout.tsx`): also `stores.groceryPrices`, `stores.aisleLinks` and `pantry.suggestions`, which take no input and are read below the boundary.
- The recipe page (`app/(app)/recipes/[id]/layout.tsx`): also `ratings.getAverage` and `ratings.getUserRating` for the recipe, and `cookbooks.forRecipe` only when the reader's Device Preferences show the cookbooks card. Hearts come with 03.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] `first-paint.e2e.ts`: the server's markup has a grocery's price and its aisle heading, and a recipe's rating.
- [ ] 01's harness: before and after for `/groceries`, `/groceries/pantry` and a recipe, with the document size.

## Comments
