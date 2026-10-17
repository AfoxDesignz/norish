# 08: AI reads a name as several foods, a tool or nothing

**What to build:** AI's question about a name gains three answers, both at import (rung 3) and in the background pass:

- **Several foods**, with how they're joined. Acted on only when AI is sure: "Dijon or yellow mustard" becomes two mustards as alternatives. Unsure, the name stays one food. On an existing food, a sure split moves every line, grocery, recurring grocery and pantry entry that points at it, and then removes the joined food.
- **A tool** ("taart- of springvorm (doorsnede 26 cm)", "deegroller"). The line stays in the recipe, names no food and never goes on the list. An existing tool food is deleted, its lines keep their text, and the deletion is an AI Change whose Undo re-mints the food and points its rows back at it.
- **Names nothing** ("melted", "roughly chopped", "overnight and drained"). The text has already been cleaned (01), so this is real junk. A sure answer deletes the recipe line as a Junk Line, at import (the line isn't stored) or from an existing recipe. It's recorded as an AI Change whose Undo puts the line back at its position and remembers its text as not junk.

An unsure tool or junk answer mints or keeps the food, flagged with that reason. Its flag offers **Delete as junk**, which deletes the food and its recipe lines, each one restorable from Changed by AI. AI never deletes a Grocery or a Pantry Ingredient a person typed: one that names nothing stays and points at no food.

See `CONTEXT.md` (Junk Line, AI Change) and ADR-0037's 2026-10-17 amendments.

**Blocked by:** 01, 04, 07

**Status:** ready-for-agent

- [ ] A sure "several foods" answer splits "Dijon or yellow mustard" into two alternatives. An unsure one leaves one food.
- [ ] A sure split of an existing joined food re-points all its rows and removes the food.
- [ ] A sure tool answer keeps "deegroller" in its recipe with no food, and it is skipped when the recipe is added to the groceries.
- [ ] A sure junk answer removes "melted" from "snickers ice cream bars", lists it on Changed by AI, and Undo restores it at its position. Asked again, it is not deleted.
- [ ] Junk at import: the line is not stored, and the AI Change lists it.
- [ ] An unsure junk answer flags the food with Delete as junk. Using it deletes the food and its lines, each restorable.
- [ ] A typed grocery that AI says names nothing stays on the list.
- [ ] Resolver and pass tests cover each answer, sure and unsure, against a real database with AI mocked at the runtime.
- [ ] Browser: a junk line deleted by the AI stub is restored from Changed by AI.
- [ ] All `CONTRIBUTING.md` gates pass.
