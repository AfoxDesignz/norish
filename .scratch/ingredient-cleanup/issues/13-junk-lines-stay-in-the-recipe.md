# 13: Junk lines stay in the recipe

**What to build:** Take the Junk Line deletion from 08 back out. Mike, 2026-10-20: "the recipe should remain as is, melted in this case has to point to nothing as in the catalogue it is REMOVED, so that users can still fix recipes themselves." Keeping the catalogue never changes a recipe's lines.

- **One answer, "not a food"** (Mike, 2026-10-20: "one not a food"), replaces "tool" and "nothing" in the prompt, the language model's verdict, the Decision's options and `AIResolution`. It covers kitchen equipment the cook has, a preparation or fragment on its own line, a note and gibberish. Anything a household buys stays "same", "kind-of" or "new", as the prompt says today.
- **Sure or not, it acts.** At import the line is stored as written and names no food, and nothing is minted. In the pass the food is deleted; its recipe lines, groceries and recurring groceries keep their text and point at no food. The deletion is a `not-a-food` AI Change whose Undo re-mints the food and points its rows back; an Undo keeps AI off that food.
- **Pantry:** a food a Pantry Ingredient names stays, flagged `ai-junk` (its copy loses "and was not sure"). The panel offers the plain Delete; Delete as junk goes.
- **What goes with it:**
  - the `junk-line` and `tool` AI Change kinds, the `junk-line` Undo (`restoreDeletedLine`) and the `tool` copy;
  - `deleteJunkLines`, `junkLine` and `recordJunkLinesTx`;
  - the "kept as not junk" memory (`findFoldsKeptAsNotJunk`);
  - `ingredient_ai_changes.recipe_id` and its index. Migration 0079 is unreleased, so it shrinks; no later migration drops them.
  - Changed by AI's recipe rows and their policy checks;
  - `asJunk` on `remove`, and the translations only these used.

See `CONTEXT.md` (Junk Line, AI Change), ADR-0037's 2026-10-20 amendment, and the rewritten spec.

**Blocked by:** 08

**Status:** needs-triage (Mike, 2026-10-20: "Don't change code yet")

- [ ] AI answers "not a food" for "melted" and for "deegroller"; the prompt, the schema and the Decision offer no "tool" or "nothing".
- [ ] A recipe imported with "melted" keeps the line as written, naming no food. Nothing is minted, and nothing is listed on Changed by AI.
- [ ] "Not a food" in the pass, sure and unsure, deletes the food, and "melted" stays in "snickers ice cream bars" with no food. Undo on Changed by AI re-mints the food and points the line back at it. Asked again, AI leaves it alone.
- [ ] A food a Pantry Ingredient names stays, flagged, and the panel's Delete keeps its lines.
- [ ] No code path deletes a recipe line to keep the catalogue: the junk-line kind, its column and Delete as junk are gone.
- [ ] Browser: the junk scenario becomes "AI removes a food that names nothing; its line stays in the recipe with no food, and Undo brings the food back".
- [ ] All `CONTRIBUTING.md` gates pass.
