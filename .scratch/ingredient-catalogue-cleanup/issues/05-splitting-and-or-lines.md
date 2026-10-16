# 05: Splitting "and"/"or" lines by words, language and AI

**What to build:** a new name becomes a Compound Spelling when its words say so: every part is a known food, and the joining word means "and" or "or" in the language the name was written in. Otherwise AI decides in the background, and where AI is off or unsure, the food is flagged with a split suggestion. See ADR-0040 and the Compound Spelling entry in `CONTEXT.md`.

**Blocked by:** 01, 04

**Status:** ready-for-agent

- [ ] **Ingredient Words.**
  - Add an "or" list for all 14 languages in `packages/config/src/ingredient-words.default.json`, and check every language's "and" (`joiners`) list.
  - An administrator's edited set that lacks the new list gets it from the defaults.
  - Show it on Admin → Content Detection → Ingredient words.
- [ ] **The language a name was written in.**
  - **Recipe line:** the majority among the locales of the seeded aliases the recipe's other lines resolved to.
  - **Grocery, recurring grocery, Pantry Ingredient:** the typing person's UI locale.
  - Nothing is stored. When too few lines resolved to say, the language is unknown.
- [ ] **The word split** runs at mint time, at rungs 1–2, without AI. Split when every part resolves to a known food at rungs 1–2 and the word is an "and"/"or" word in that language. An unknown language splits only on a word that means "and"/"or" in every language that has it, and has no other role in any. Results:
  - "sale e pepe" splits;
  - "kipfilet of kippendijfilet" in a Dutch recipe splits;
  - "juice of lemon" in an English recipe doesn't;
  - "sweet and sour sauce" matches the seed first.
- [ ] **AI.** Settling (01) gains the answer "several foods: X and Y" / "X or Y". A sure answer becomes a Compound Spelling; an unsure one leaves a split suggestion (04).
- [ ] **Without AI,** a mint whose words would split but whose word is ambiguous is flagged with a split suggestion.
- [ ] **Tests:**
  - the language vote;
  - each of the four example names;
  - the ambiguous-word fallback;
  - an edited word set gaining the "or" list.

## Comments
