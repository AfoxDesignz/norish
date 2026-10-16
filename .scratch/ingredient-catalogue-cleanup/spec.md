# Ingredient catalogue cleanup

Status: ready-for-agent

## Problem Statement

The catalogue fills with mess faster than anyone can review it. On 2026-10-16 a 480-recipe Italian archive import minted 504 Ingredients, 84 of them flagged:

- **58 because AI did not answer in time.** Rung 3 has 8 s a name, four names at a time, while the archive saves one recipe after another. It also makes every import slow.
- **Text that is no food:** "Winston55", "Buon'Idea", "spesso)", "la buccia grattugiata di".
- **Lines with "and"/"or"** ("sale e pepe", "prosciutto crudo o speck"). These became foods of their own, filed under whichever food the words ended on.
- **Clear cases AI missed.** Its candidates are only foods sharing a four-letter word start with the name, and the Decision acts only at 0.8.

Ask AI rounds only write suggestions, so even a sure answer waits for a person to confirm it.

The Ingredients page lists all ~6,250 foods, 85% of which nothing uses, plus one-off grocery things such as a carton box.

Renaming a food to a name another food holds is either refused ("Another ingredient already has this name") or, when the name is only another food's spelling, saved without the spelling and without telling anyone.

## Solution

Glossary: **Ingredient Catalogue**, **Compound Spelling**, and the amended Ingredient Alias, Flagged Ingredient and Ingredient Words entries in `CONTEXT.md`. Decisions: ADR-0037 (three amendments of 2026-10-16) and ADR-0040.

1. **Background settling.** No path asks AI while a text is saved.
   - Rungs 1 and 2 resolve; anything they miss is minted at once.
   - The `new-ingredients` job settles each new food first, before its Plain Name and icon, with no time budget.
   - AI can answer: same as X, a kind of X, a food of its own, names no food (recipe lines only), or names several foods.
   - A sure answer is applied. An unsure one leaves the flag and a suggestion.
   - AI fixes flagged foods only; it may merge one into any food. A person's rename, parent or Mark distinct clears the flag, and an unflagged food is taken to be clean. Using a food changes nothing.
   - Fix catalogue (Ask AI rounds) applies sure answers the same way, and gains a re-check of every food not from the seed, the one way AI looks at clean foods again.
2. **Better answers.** Candidates are also found by AI's English reading of the name. The Decision acts at 0.5, as grocery linking does.
3. **Names no food.** A recipe line AI is sure names no food points at nothing, as a heading does. It keeps its text, and the mint is removed.
4. **Compound Spelling.** A spelling may name several foods, "and" or "or" (ADR-0040).
   - **Pantry:** an "and" counts when all its foods are kept, an "or" when any one is.
   - **Groceries:** one Grocery per food; for an "or", all but the first start unticked and the screen says why.
   - **Icon:** the first food's.
   - **Nutrition:** the first food's for an "or"; an "and" is left out as naming several foods.
   - **Splitting:** by words when every part is known and the joining word means "and"/"or" in the worked-out language; else by AI; else flagged with a split suggestion.
5. **Renaming onto a taken name.** Save asks: add as a translation of that food, or merge under the typed name.
   - The merge also rewrites the spelling's words in the recipes the person may edit and on their household's groceries.
   - The Merge button only adds as translation, and its copy says the two "become one food".
   - Any merge needs edit rights on the disappearing food only.
6. **The Ingredient Catalogue.** The seeded foods plus those recipes name, read from what points at them.
   - The page shows recipe-named and flagged foods by default; **Show all** adds the seed.
   - Foods only groceries or the Pantry name are never listed, found, counted or asked about.
   - A scheduled cleanup deletes the ones nothing names and nothing is remembered about.
7. **Upgrade.** Without AI: the cleanup, the word splits and rung 1–2 merges. When AI is on: untouched flagged foods whose AI step never ran (`ai-unavailable`, `unknown-food`, `ai-key-rejected`) are queued. Every other flag waits for Fix catalogue.

## Decisions

- Mike accepts that a line's food settles seconds after it is saved, and that AI acts without confirmation on flagged foods. Unflagged foods are clean until a person asks for a re-check, which may merge or split them whatever was decided before (Mike, 2026-10-16: "we can assume these are clean unless the user specifically asks the whole library"). Remembering two foods a person separated is left out until a re-check is seen re-merging them.
- A recipe's text is never changed by AI. The only rewrite is a person's rename-merge, limited to recipes they may edit.
- One-off grocery things stay Ingredients, kept out of the catalogue, rather than being remembered by name (ADR-0037 amendment).
- Compound Spellings are decided per spelling, not per line (ADR-0040).
- The recipe's language is worked out from its lines' seeded spellings, not stored. It is used for splitting only; rung 2 keeps reading every language.
- No AI tokens are spent on upgrade except for foods whose AI step should already have run.

## Out of scope

- Shrinking the seed or dropping seed languages. The catalogue is ~25 MB of a 96 MB dev database, and the matcher needs it.
- Rung 2 reading per language (the Spanish "en" still cuts "zout en peper" in parent-from-words; the split catches that line first).
- Remembering that a text names no food, so a repeat is not asked again.
- Mobile.

## Testing

- **The check that matters:** re-run the 2026-10-16 Italian import on a reset dev database, before and after. Report flags by reason and the import time per recipe.
- Unit and integration tests are listed per ticket. The browser spec and docs are in ticket 08.

## Comments
