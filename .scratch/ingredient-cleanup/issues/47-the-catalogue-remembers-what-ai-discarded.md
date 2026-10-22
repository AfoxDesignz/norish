# 47: The catalogue remembers what was discarded

**What to build:** Mike, 2026-10-22: "can't we make the DB smart by keeping a list of discarded shit, so that in the future we no longer need that AI call", and "the next import of boneless can be thrashed instantly, it's trash not an ingredient". Today a text AI deleted as not a food is minted again by the next recipe that writes it. AI is then asked again and deletes it again. Each time that costs a request and leaves an AI Change.

**Fix: a junk pile.** One table: `fold` (unique), `reason`, `created_at`, and the AI Change id, nullable, for Undo.

- **What goes on it:**
  - AI deletes a food as not a food (`deleteByAI`): the folds of its spellings, which `readDeletedFood` already reads.
  - Ticket 46 removes a spelling as not a food: its fold.
  - A person removes a spelling by hand (`removeAliasIn` in `catalogue.ts`, the Ingredients panel's remove and `saveDraft`): its fold, with no change id. Mike: "safe to assume deleting a translation junks it".
- **Not stored:** a spelling 46 finds names another food, or not this food. Its text is a real food somewhere, so the next line must still find or mint it.
- **What comes off it:**
  - Undo of the AI Change that put it there.
  - A person adding a spelling by hand (`addAliasIn`) whose fold is on the pile. A person who removed a spelling to put it on another food clears it this way.

**The rule, in one place in the resolver (Mike, 2026-10-22).** Where the resolver cuts a text into pieces, a piece whose fold or plain fold is on the pile is dropped. The cuts are the comma cut (`stripPreparation`'s `split(",")[0]`) and the joining words (`spelledParts`). The text is then read on the pieces left. So "boneless, skinless chicken breasts" drops "boneless" and is read as "skinless chicken breasts". Only when every piece is on the pile, as with "boneless" alone, does the text name no food.

- It then follows the Junk Line rule (CONTEXT.md; ticket 13). At import the line is stored as written and names no food. Nothing is minted, no AI is asked, there is no flag, and nothing goes on Changed by AI.
- A typed Grocery or Pantry Ingredient is never junk. It is kept and points at no food, as any text naming none does.
- Make the drop one function, called where `spellingOf` makes the comma pieces and where `spelledParts` makes the parts. The pile is read with the rules (`currentRules`, beside the units and the words), and the cache is dropped when the pile changes, so a cleanup step that adds to it resolves with it at once.
- No `RUNG_VERSION` bump: the pile starts empty, so no stored resolution changes.

**Seeing and clearing it:** Changed by AI's Undo clears what AI put there, and adding the spelling back clears a person's removal. That suffices for now.

- **Later:** a page to view and edit the pile. No ticket now.

**Blocked by:** None. Ticket 46 adds its "not a food" spellings to the pile, and relies on the piece rule for its lines.

**Status:** ready-for-agent

- [ ] After AI deletes "melted" as not a food, a new recipe with the line "melted" stores it as written, names no food, mints nothing and asks no AI. Undo of that AI Change takes "melted" off the pile, and the next import mints it again.
- [ ] With "boneless" on the pile, "boneless, skinless chicken breasts" is read on "skinless chicken breasts", never as no food. "boneless" alone names no food.
- [ ] Removing the spelling "boneless" by hand puts it on the pile, and adding "boneless" by hand to any food takes it off.
- [ ] A typed Grocery "boneless" is kept, naming no food.
