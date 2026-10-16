# 01: Settle new ingredients in the background

**What to build:** no path asks AI while a text is saved. Rungs 1–2 resolve and anything they miss is minted at once. The `new-ingredients` job settles each new food before its Plain Name and icon, and applies a sure answer without anyone confirming it. Fix catalogue applies sure answers the same way. See the spec, item 1, and ADR-0037 (amended 2026-10-16).

**Blocked by:** none

**Status:** ready-for-agent

- [ ] **The resolver stops at rung 2 and mints.**
  - Delete rung 3 from the save path: `askWhatFoodThisIs` in `resolver.ts`, `AI_CONCURRENCY`, and the 8 s `RESOLUTION_BUDGET_MS`.
  - A mint is flagged until settled. Choose a reason that says it is waiting for AI, and set it to `ai-off` when AI is off.
  - The parent from words stays at mint time.
- [ ] **Every mint is announced, whatever `getAutomaticIngredientsConfig()` says.**
  - The producer always queues while AI is on.
  - The worker settles first, then runs the Plain Name and icon steps only if they are switched on and the food still exists.
- [ ] **Settling.** It reuses rung 3 (`ai/resolution/ingredient-resolution.ts`), and skips a food that is gone, `kept_distinct`, `parent_chosen`, or renamed by a person. A sure answer is applied:
  - **same as X:** merge into X (`mergeCatalogueIngredients`). The lines follow their aliases.
  - **a kind of X:** set the parent (not `parent_chosen`) and unflag.
  - **new:** unflag.
  - **unsure:** keep the flag and write a suggestion, as an Ask AI round does today.
  - Tickets 03 and 05 add the "names no food" and "several foods" answers.
- [ ] **Race safety.** Settling takes the tree lock. It re-reads the food's decision markers under the lock, and does nothing if a person decided meanwhile.
- [ ] **Realtime.** A merge or move that re-points groceries, recurring groceries or Pantry rows publishes their changes, so the list picks up the new food's aisle and price without a reload. This covers a person's merge too; today nothing is published (`ingredient-relocation.ts` `mergeCatalogueIngredients`).
- [ ] **Fix catalogue applies sure answers.**
  - In `review.ts`, `suggest()` applies a sure merge, parent or distinct on an untouched food through the same code as settling.
  - Only an unsure answer becomes a suggestion.
  - The round's report lists what was applied.
  - Copy: the round dialog's "Nothing changes until you confirm a suggestion" goes, in all locales.
  - Fix the router docstrings at `trpc/src/routers/ingredients/index.ts:255-285`, which already claimed this.
- [ ] **Import speed.** An archive import with AI on saves recipes without waiting on a model. Log the per-recipe save time once, to have a number for the spec.
- [ ] **Tests:**
  - the resolver mints without calling the runtime;
  - settling applies each sure verdict;
  - settling skips each decided marker;
  - a person's decision during settling wins;
  - Fix catalogue applies a sure answer and suggests an unsure one;
  - the worker settles before naming;
  - a merge publishes grocery and Pantry changes.

## Comments
