# 13: Junk lines stay in the recipe

**What to build:** Take the Junk Line deletion from 08 back out. Mike, 2026-10-20: "the recipe should remain as is, melted in this case has to point to nothing as in the catalogue it is REMOVED, so that users can still fix recipes themselves." Keeping the catalogue never changes a recipe's lines.

- **At import:** a line AI is sure names nothing is stored as written and names no food, as a tool's line is. Nothing is minted for it.
- **In the pass:** "names nothing" deletes the food the way "tool" does. Its recipe lines, groceries and recurring groceries keep their text and point at no food. The deletion is a `not-a-food` AI Change whose Undo re-mints the food and points its rows back. A Pantry Ingredient keeps the food, flagged, as for a tool.
- **Unsure:** an unsure "nothing" still flags the food `ai-junk`, and the panel offers the plain Delete. Delete as junk goes.
- **What goes with it:**
  - the `junk-line` AI Change kind and its Undo (`restoreDeletedLine`);
  - `deleteJunkLines`, `junkLine` and `recordJunkLinesTx`;
  - the "kept as not junk" memory (`findFoldsKeptAsNotJunk`);
  - `ingredient_ai_changes.recipe_id` and its index. Migration 0079 is unreleased, so it shrinks; no later migration drops them.
  - Changed by AI's recipe rows and their policy checks;
  - `asJunk` on `remove`, and the translations only these used.

With this, a tool and "nothing" are handled alike except when AI is unsure. Whether to keep two answers is Mike's call.

See `CONTEXT.md` (Junk Line, AI Change), ADR-0037's 2026-10-20 amendment, and the rewritten spec.

**Blocked by:** 08

**Status:** needs-triage (Mike, 2026-10-20: "Don't change code yet")

- [ ] A recipe imported with "melted" keeps the line as written, naming no food. Nothing is minted, and nothing is listed on Changed by AI.
- [ ] A sure "nothing" in the pass deletes the food, and "melted" stays in "snickers ice cream bars" with no food. Undo on Changed by AI re-mints the food and points the line back at it. Asked again, AI leaves it alone.
- [ ] An unsure "nothing" flags the food, and the panel's Delete keeps its lines.
- [ ] No code path deletes a recipe line to keep the catalogue: the junk-line kind, its column and Delete as junk are gone.
- [ ] Browser: the junk scenario becomes "AI removes a food that names nothing; its line stays in the recipe with no food, and Undo brings the food back".
- [ ] All `CONTRIBUTING.md` gates pass.
