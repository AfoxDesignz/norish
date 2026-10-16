# 11: Line Texts

**What to build:** a line's raw text that carried more than the food ("GR TONIJN UIT BLIK", "onions, diced", "2 garlic cloves crushed") becomes a hidden **Line Text**, no longer a spelling. Lines keep pointing at it, so the same text is still found without AI and an unmerge still moves its lines. But it is never listed as a translation, never offered as a name, and deleted once nothing is written that way. Recipe lines keep their text. See the Line Text entry in `CONTEXT.md`.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] **Data.** An alias records whether it is a spelling or a Line Text.
  - The resolver stores a text as a Line Text when rung 2 took something off it, and its bare/plain form as a spelling (`addIngredientAliases`, the mint).
  - A person's typed translation, a seeded name and a Plain Name are always spellings.
- [ ] **Readers that list or offer names skip Line Texts:**
  - the Ingredient panel's translations;
  - `localeNames`;
  - the picker's and the page's search;
  - the catalogue JSON;
  - the AI candidate lists in `ingredient-resolution.ts`, which show foods with their spellings.

  Resolution (rung 1) still matches them.

- [ ] **Cleanup.** The scheduled cleanup (07) also deletes Line Texts that no recipe line, Grocery, recurring grocery or Pantry Ingredient points at.
- [ ] **Clean names with AI** (the round and the automatic clean of new ingredients) also answers which of a food's non-seeded spellings are no names. Those become Line Texts. A name a Plain Name replaces becomes a Line Text too, when nothing else made it a spelling.
- [ ] **Upgrade.**
  - Non-seeded aliases whose rung-2 key differs from their fold become Line Texts.
  - So do the aliases a food was minted with, where a Plain Name has since replaced its name. Those are the aliases written with the food, while the plain-name alias has no owner (`settleIngredientName`).
  - Then the cleanup runs.
  - Junk nothing strips ("heaped cups plain flour") stays a spelling until a clean round or a person moves it.
- [ ] **Tests:**
  - the resolver stores a stripped text as a Line Text and its key as a spelling;
  - Line Texts are hidden from every listing but still resolve;
  - the cleanup removes unused ones;
  - clean demotes AI's "no name" spellings;
  - the upgrade classification;
  - a recipe line reads unchanged.

## Comments
