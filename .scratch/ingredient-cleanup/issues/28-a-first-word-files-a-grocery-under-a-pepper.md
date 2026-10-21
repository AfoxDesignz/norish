# 28: A first word that is a seeded spelling files a food under it

**What to build:** Found by ticket 12. With AI off, the first start's recheck filed an own food a grocery named under spicy red pepper, as an unsure parent from its words: the name starts with a name that, once folded, is a seeded spelling of a pepper, followed by "reserve eten". The flag and Undo catch it, but the words should not have given that parent. With AI on, AI then deleted the food as not a food; ticket 25 hides it instead.

**Fix (Mike, 2026-10-21):** the unsure parent from the words goes. A parent comes from the words only where its spelling ends the name ("ground cumin" under cumin), or starts it before cuts and forms alone ("mango blokjes" under mango). A spelling anywhere else gives no parent. On the production copy that guess filed one food, this wrong one. Ticket 22's four-letter rule only served that guess and goes too; its cases ("olie om te bakken", "raw king prawns") then get no parent at all. With AI on, AI files the parent. `RUNG_VERSION` goes up, so the startup recheck files old mints again.

**Blocked by:** None

**Status:** done

- [x] "Nora reserve eten" gets no parent from its words.
- [x] "ground cumin" stays under cumin and "mango blokjes" under mango.
- [ ] All `CONTRIBUTING.md` gates pass.

## Comments

2026-10-21, implemented (b8b63b7ed, 57534e92b):

- `parentFromWords` in `packages/shared-server/src/ingredients/resolver.ts` now returns the parent's id or null: only the window the name ends with (and its singular) and the window it starts with before forms and sizes alone are read. `ParentFromWords` and its `sure` are gone, as are `parentUnsure` on `MintIngredientInput`, `recordGuessedParent`, and the `unsure` argument of `fileUndecidedMint` and `refileOwnFood`. `RUNG_VERSION` is 10.
- The recheck still reads an older rule's open guess (`UndecidedMint.guessed`, `parentIsOpenGuess`): the bump files it again under the parent its words now give, quietly, or takes it off ("garlic cloves crushed" under garlic loses it). The stored `fromWords` and the "from its name" copy on Changed by AI stay for rows an rc instance already holds (kept or undone guesses, listed for a month; an undone one still blocks that parent). They could go once no instance holds such rows. Tests make such a row with `fileAsOldWordsGuess` in `packages/db/__tests__/helpers/db-test-helpers.ts`.
- "olie om te bakken" stays under oil, not without a parent as the ticket says: ticket 20 reads the name up to "om", so "olie" is the whole name and ends it. It is never tea.
- Lost with the rule, now left to AI: "onion powder", "chili flakes", "curry leaves" (no parent instead of an unsure one), "garlic cloves", "kale large stalks removed". "dried guajillo peppers" with only "pepper" seeded now goes under pepper, the singular its name ends with; guajillo sat inside the name.
- The seed correction (`correctSeedOnce`) re-files only own foods whose words give the new food; a "seasoning blend" never had a parent from its words now.
