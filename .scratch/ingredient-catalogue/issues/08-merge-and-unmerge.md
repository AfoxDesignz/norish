# 08: Merge and unmerge

**What to build:** On the Ingredients page, *merge into…* moves every alias of one Ingredient onto another and deletes the source. Every recipe line, grocery and Pantry Ingredient behind those aliases now means the target, with no re-pointing. Where both Ingredients have a Product Link, Aisle Link or store preference at the same Store, the target's is kept. *Move alias to…* is the unmerge: it moves one alias to another Ingredient, or to a new one. Merging needs `edit` on both Ingredients, and moving an alias needs `edit` on the alias. Merge, alias move and rename publish one broadcast *ingredients changed* event, and clients refetch ingredient-derived data idempotently. A housemate's merge refiles your list at once.

**Blocked by:** 04, 07

**Status:** ready-for-agent

- [ ] Resolver tests: merging "uien" into "onion" files a grocery typed "uien" in onion's Aisle, collisions keep the target's links, and moving an alias back restores what it resolves to.
- [ ] A merge clears the source's flag by removing the source. Moving an alias out of a flagged Ingredient leaves the flag alone.
- [ ] Policy tests cover merge needing both Ingredients and alias moves.
- [ ] The broadcast event is in the realtime catalogue, and its handlers merge by id.
