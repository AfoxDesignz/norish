# 14: Import asks no AI

**What to build:** A recipe import or save, a typed grocery, a recurring grocery and a Pantry add resolve a name without AI. Mike, 2026-10-20: "needs to be dropped for sure". Only the background pass (07) asks AI, moments after the mint.

- **What still finds a food at import**, AI on or off:
  - a translation Norish already has, with plurals, amounts, units and preparation read past ("4 el bosui", "onions, diced");
  - the joining words ("zout en peper" is zout and peper);
  - a slip of the fingers ("barmezaan" is parmezaan). It is taken at once, as AI off takes it today (Mike, 2026-10-20: "with the fuzzy matching indeed should be quite reliable"). The pass never sees it.
- **Anything else** becomes a new ingredient, flagged, and the pass decides about it.
  - The flag's copy says AI looks at it shortly, not that AI was not asked.
  - With AI off it is `ai-off`, as today.
- **What goes:**
  - rung 3 at import: the Decision and the language model;
  - the 8-second budget (`RESOLUTION_BUDGET_MS`);
  - the unsure join at import.
- **What the pass now does instead of the import:**
  - "Dijon or yellow mustard" is minted whole, and the pass splits it when AI is sure;
  - "melted" and "deegroller" are minted, then deleted by the pass as not a food. Each is listed on Changed by AI with Undo. This replaces ticket 13's "nothing is minted, and nothing is listed on Changed by AI" at import.

**Blocked by:** 13, 09 (both done)

**Status:** ready-for-agent

- [ ] A recipe saved with AI on makes no AI request while it saves; the pass makes them afterwards.
- [ ] "barmezaan" in a recipe points at parmezaan when the recipe is saved, AI on or off.
- [ ] "rode uien" with no translation for it becomes its own flagged ingredient. The pass then files it under onion.
- [ ] "melted" in a new recipe is minted, then deleted by the pass. It shows on Changed by AI, and Undo brings it back with its line.
- [ ] Adding a grocery never waits on AI.
- [ ] `resolver-ai.test.ts`'s import-time cases move to the pass's tests or go. E2E stubs that answered import questions answer the pass instead.
- [ ] Release notes and the Ingredients docs page say nothing of AI at import.
- [ ] All `CONTRIBUTING.md` gates pass.
