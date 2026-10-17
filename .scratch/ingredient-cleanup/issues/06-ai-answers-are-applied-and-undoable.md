# 06: AI's answers are applied and can be undone

**What to build:** When AI is asked about a food, it no longer leaves a suggestion; it makes the change. The review pass (today's Ask AI and Fix catalogue round) applies every answer: merge into a known food, parent, Plain Name, or a food of its own. A sure answer raises no flag. An unsure answer is applied too, and flags its food.

Every change is an **AI Change**, stored with what Undo needs, and listed on a new **Changed by AI** view on the Ingredients page:
- unsure changes come first, with **Keep** and **Undo**;
- sure changes come after, with **Undo**;
- each row names its food.

**Keep** clears the flag and counts as a person's decision, so AI won't ask about that food again. **Undo**, per kind:
- merge: the moved translations go back out to a food of their own, carrying their lines;
- parent: the former parent comes back;
- Plain Name: the former name comes back, and the name is settled.

An undone change is remembered, so AI never makes it again. Undo and Keep follow the food's edit policy. A flagged food stays marked in the Ingredients list, and the mark opens its unsure changes.

The suggestions table, the Suggestions panel and Confirm all are removed. Ask AI and Fix catalogue stay as triggers until 07.

See `CONTEXT.md` (Flagged Ingredient, AI Change, Plain Name) and ADR-0037's first 2026-10-17 amendment.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A sure merge answer merges and records a sure AI Change, with no flag.
- [ ] An unsure parent answer sets the parent, flags the food and lists the change under Keep and Undo.
- [ ] Undo per kind restores the prior state: the merged translations and their lines are back on a food of their own, the old parent is back, the old name is back and settled.
- [ ] The same question asked again after an Undo does not repeat the undone change.
- [ ] Keep clears the flag, and a later round skips the food.
- [ ] Foods a person kept distinct, renamed or parented, and seeded foods, are not asked about.
- [ ] The suggestions table is dropped by a migration. The Suggestions panel, Confirm all and their translations are gone.
- [ ] Browser: Ask AI on a flagged food (AI stub) merges it, the merge shows on Changed by AI, and Undo puts it back. The two suggestion scenarios in the catalogue spec are rewritten to this.
- [ ] Pass tests run against a real database with AI mocked at the runtime, replacing the review, suggestion and plain-name tests. All `CONTRIBUTING.md` gates pass.
