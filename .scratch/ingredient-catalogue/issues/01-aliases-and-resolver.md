# 01: Aliases and the resolver: exact, stripped, mint

**What to build:** Introduce the Ingredient Alias and the resolver, the one module in `packages/api` allowed to mint Ingredients and aliases. Every existing `ingredients` row becomes an Ingredient with its own name as its first alias. Recipe save and import resolve each line's as-written text by trying, in order: an exact alias match on the fold, the fold with the text after the first comma and any bracketed text removed, and finally a newly minted Ingredient. Importing "2 onions, diced" next to an existing "onion" resolves to that onion. The recipe line keeps its text as written in a new column and still reads "2 onions, diced". This is the *expand* step: the alias pointer lives beside the existing ingredient pointer and folded-name keys, and nothing downstream changes yet. A mint made without an AI step is flagged. See `.scratch/ingredient-catalogue/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The `ingredient_aliases` table exists with its text, fold (unique), optional locale, Ingredient, nullable owner and seeded marker. `ingredients` gains a nullable owner and a flagged marker.
- [ ] A migration gives every existing Ingredient its name as an alias. Recipe lines point at an alias and carry their as-written text, and the display is unchanged for existing recipes.
- [ ] Resolution order rungs 1, 2 and 4 are implemented, and every recipe-minting path goes through the resolver.
- [ ] A mint records its owner (the acting user) and is flagged.
- [ ] Resolver tests run in `packages/api` against a real database (testcontainers) under the existing test gate.
- [ ] CONTEXT.md gains Ingredient, Ingredient Alias and Flagged Ingredient. "Ingredient Name" is retired.
- [ ] An ADR records *ingredient identity is an alias pointing at an Ingredient*.
