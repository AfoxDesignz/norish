# 47: The catalogue remembers what was discarded

**What to build:** Mike, 2026-10-22: "can't we make the DB smart by keeping a list of discarded shit, so that in the future we no longer need that AI call", and "the next import of boneless can be thrashed instantly, it's trash not an ingredient". Today a text AI deleted as not a food is minted again by the next recipe that writes it. AI is then asked again and deletes it again. Each time that costs a request and leaves an AI Change.

**Fix: a junk pile.** One table: `fold` (unique), `reason`, `created_at`, and the AI Change id, nullable, for Undo.

- **What goes on it:**
  - AI deletes a food as not a food (`deleteByAI`): the folds of its spellings, which `readDeletedFood` already reads.
  - Ticket 46 removes a spelling as not a food: its fold.
  - A person removes a spelling by hand and says it is not a food (see "Removing a spelling by hand"): its fold, with no change id.
  - The pile seed (below), at boot.
- **Not stored:** a spelling 46 finds names another food, or not this food. Its text is a real food somewhere, so the next line must still find or mint it.
- **What comes off it:**
  - Undo of the AI Change that put it there.
  - A person adding a spelling by hand (`addAliasIn`) whose fold is on the pile. A person who removed a spelling to put it on another food clears it this way.

**The rule, in one place in the resolver (Mike, 2026-10-22).** Where the resolver cuts a text into pieces, a piece whose fold or plain fold is on the pile is dropped. The cuts are the comma cut (`stripPreparation`'s `split(",")[0]`) and the joining words (`spelledParts`). The text is then read on the pieces left. So "boneless, skinless chicken breasts" drops "boneless" and is read as "skinless chicken breasts". Only when every piece is on the pile, as with "boneless" alone, does the text name no food.

- It then follows the Junk Line rule (CONTEXT.md; ticket 13). At import the line is stored as written and names no food. Nothing is minted, no AI is asked, there is no flag, and nothing goes on Changed by AI.
- A typed Grocery or Pantry Ingredient is never junk. It is kept and points at no food, as any text naming none does.
- Make the drop one function, called where `spellingOf` makes the comma pieces and where `spelledParts` makes the parts. The pile is read with the rules (`currentRules`, beside the units and the words), and the cache is dropped when the pile changes, so a cleanup step that adds to it resolves with it at once.
- No `RUNG_VERSION` bump: on the copy (`m31c_post_on`) no spelling holds a pile seed text except "boneless" and "lbs boneless" (ticket 46's), so no stored resolution changes.

**Removing a spelling by hand (Mike, 2026-10-22: "a popup when it's the last asking if it's junk and should be marked as such").** Today a spelling is removed in the Ingredient panel's Translations sub-panel (`apps/web/components/ingredients/ingredient-panel.tsx`, `spellingChip`): its cross stages the removal in the draft (`removed`, struck through), and Save sends it through `trpc.ingredients.saveDraft` (`packages/trpc/src/routers/ingredients/index.ts`) to `saveDraft` → `removeAliasIn` in `packages/shared-server/src/ingredients/catalogue.ts`. There is no dialog yet. (The `ingredients.removeAlias` procedure and `removeAlias` have no web caller; they stay a plain delete.)

- **Another food still holds the text** (another alias with the same fold): the cross stages a plain removal, as today. Nothing goes on the pile.
- **The last copy of the text in the catalogue:** the cross opens a small confirm modal, shaped like `DeleteIngredientModal` (`delete-ingredient-modal.tsx`). "Not a food" stages the removal and marks it for the pile. "Just remove" stages a plain removal. Closing it stages nothing.
- **What the client needs:** `IngredientSpelling` (`spelling()` in `catalogue.ts`) gains `elsewhere: boolean`, true where another food holds the fold, read by one repository query beside the spelling read.
- **What the server does:** the draft gains `junk: string[]`, the alias ids marked for the pile and a subset of `remove`. The `saveDraft` input gains `junk: z.array(z.uuid()).max(100)`. `removeAliasIn` puts the fold on the pile only for an id in `junk` and only when, in the transaction, no other alias holds the fold. A stale `elsewhere` then just deletes. A refused Save restores `junk` with the rest of the draft.
- **Copy** (`settings.ingredients`, sentence case, in all 16 locale folders under `packages/i18n/src/messages/`):
  - `junkTitle`: "Mark {alias} as not a food?"
  - `junkBody`: "No other ingredient has this translation. New recipes skip text marked as not a food."
  - `junkRemove`: "Just remove" (`ActionButton action="remove"`)
  - `junkMark`: "Not a food" (`ActionButton action="delete"`)

**The pile seed (Mike, 2026-10-22: "perhaps we can also preseed the junk table a bit so the parser is more accurate and remains so").** A short committed list of generic texts that name no food, put on the pile at boot like the seed corrections. Each entry is a text plus the version it came in, `JUNK_SEED` in `packages/shared-server/src/ingredients/seed/`, beside `SPELLING_MOVES`. The seed state gains `junkSeedVersion`, run through `oncePerVersion`. A pass from version N inserts only entries added after N (`reason: "seed"`, no change id, an existing fold left alone), so an entry a person took off is never added again. It runs whether or not the catalogue seed is configured.

The list (33 entries, version 1). It holds no production recipe text: only generic words, taken from what AI deleted as not a food on `m31c_post_on` (13 AI Changes, kind `not-a-food`) plus Mike's examples. English and Dutch, plus the headings, "to taste" and "optional" in German, French, Spanish and Italian, where that was cheap:

- **Headings:** ingredients, ingrediënten, zutaten, ingrédients, ingredientes, ingredienti
- **To taste:** to taste, naar smaak, nach geschmack, au goût, al gusto, q.b.
- **Optional:** optional, optioneel, facultatif, opcional, facoltativo
- **Line fragments:** boneless, skinless, chopped, roughly chopped, melted, overnight
- **Kitchen tools:** bakvorm, cakevorm, springvorm, keukenmachine, deegroller, baking dish, food processor, rolling pin
- **Broken text:** null, undefined

Left out from the copy's AI deletions because they are a recipe's own wording: "Bakvorm met opstaande randen of een braadslede", "Brownie bakvorm", "Quichevorm of springvorm van ca.", "solid part a little more than". "[object Object]" is left out too: `lineNamesNoFood` has named it no food since 22f4526c3 (`RUNG_VERSION` 3). On the copy, the 18 "[object Object]" / "null [object Object]" lines of the one AH recipe already name no food (no `recipe_ingredient_foods` rows). Ticket 48 fixes the import bug that can still write it.

**Seeing and clearing it:** Changed by AI's Undo clears what AI put there, and adding the spelling back clears a person's removal. That suffices for now.

- **Later:** a page to view and edit the pile. No ticket now.

**Blocked by:** None. Ticket 46 adds its "not a food" spellings to the pile, and relies on the piece rule for its lines.

**Status:** ready-for-agent

- [ ] After AI deletes "melted" as not a food, a new recipe with the line "melted" stores it as written, names no food, mints nothing and asks no AI. Undo of that AI Change takes "melted" off the pile, and the next import mints it again.
- [ ] With "boneless" on the pile, "boneless, skinless chicken breasts" is read on "skinless chicken breasts", never as no food. "boneless" alone names no food.
- [ ] Removing by hand the last "boneless" in the catalogue asks; "Not a food" puts it on the pile, "Just remove" does not. Removing a spelling another food also holds asks nothing and puts nothing on the pile. Adding "boneless" by hand to any food takes it off.
- [ ] After the first start, the 33 seed texts are on the pile. An entry a person took off stays off across restarts and later seed versions.
- [ ] A typed Grocery "boneless" is kept, naming no food.
