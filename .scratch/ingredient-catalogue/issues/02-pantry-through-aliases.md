# 02: Pantry through aliases

**What to build:** A Pantry Ingredient points at an alias from the resolver, and "in the pantry" is decided by Ingredient rather than by folded name. With "onions" in the Pantry, adding a recipe whose line reads "onion, diced" shows that line under **In your pantry**, unticked and left off the list. This is the *migrate* step for the pantry: existing Pantry Ingredients keep their Ingredient and gain its alias. The one-per-household rule now holds per Ingredient.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Adding a Pantry Ingredient goes through the resolver. A name that resolves to an Ingredient already in the household's Pantry is refused.
- [ ] The pantry check on adding a recipe matches on Ingredient: "onions" in the Pantry covers the line "onion, diced", and "salt" never covers "salted butter".
- [ ] Existing Pantry Ingredients migrate without loss.
- [ ] Resolver-level tests cover pantry coverage through aliases. The existing pantry router tests still pass.
