# 09: Parent Ingredient

**What to build:** An Ingredient may have a Parent Ingredient ("red onion" under "onion"). It is set or changed on the Ingredients page under `edit`, and a change that would form a cycle is refused. What follows along the tree:
- A child with no Aisle Link at a Store is filed in its parent's Aisle.
- A child in the Pantry covers a recipe line for its parent, never the reverse.
- Product Links and grocery grouping ignore the tree.

The resolution Decision's *new, child of X* answer now sets the parent, and an unsure one also flags the new Ingredient. Setting a flagged Ingredient's parent clears the flag. A parent change publishes the *ingredients changed* event.

**Blocked by:** 02, 04, 06, 07

**Status:** ready-for-agent

- [ ] Resolver tests cover the aisle fallback to the parent, no Product Link fallback, pantry coverage in both directions (including a grandchild) and cycle refusal.
- [ ] The Decision's child-of answer sets the parent. An unsure child-of answer is flagged.
- [ ] The page shows and edits the parent.
- [ ] CONTEXT.md gains Parent Ingredient, and the Pantry Ingredient entry is rewritten. ADR-0036 is superseded or rewritten to cover the Ingredient and the child-covers-parent rule.
