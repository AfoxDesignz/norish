# 02: Foods can leave the catalogue

**What to build:** Deleting a food or a translation that something still uses works instead of being refused:

- recipe lines and groceries (recurring ones too) keep their text and point at no food;
- the food's Pantry Ingredients are deleted, because the Pantry holds only foods;
- the confirm dialog says how many recipe lines, groceries and pantry entries it touches;
- the ✕ on a translation shows even while lines use it.

A nightly scheduled task, beside the existing ones, deletes foods someone's action minted once nothing has named them for 30 days. "Named" means a recipe line, Grocery, recurring grocery or Pantry Ingredient points at the food. The task does this by setting and clearing an "unused since" mark, so no write path has to touch it. A recurring grocery keeps its food alive. Seeded foods are never deleted. Recurring groceries also learn "yearly" ("every year", "jaarlijks" and each language's word), so a yearly purchase keeps its food.

See `CONTEXT.md` (Ingredient) and ADR-0037's second 2026-10-17 amendment.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Deleting a food a recipe line, grocery and Pantry Ingredient use succeeds. The line and grocery keep their text and point at no food, and the Pantry Ingredient is gone.
- [ ] Removing a translation a line uses succeeds, and the line points at no food.
- [ ] The confirm dialog shows the counts it will unlink. The old "cannot be deleted; merge it instead" copy is gone in every locale.
- [ ] An own food unused for 30 days is deleted by the nightly task; one unused for 29 days is not. Using it again clears the mark.
- [ ] A seeded food is never deleted by the task.
- [ ] A food named only by a recurring grocery is kept.
- [ ] "yearly", "every year" and "jaarlijks" parse, compute the next date and format back, with unit words in every locale.
- [ ] Browser: the catalogue spec's "one a grocery uses cannot" scenario becomes deleting a food a grocery uses, with the grocery still on the list under its text.
- [ ] All `CONTRIBUTING.md` gates pass.
