# 53: AI drops a right parent when its names do not find it

**What to build:** Found by ticket 31's run after tickets 32-48 (2026-10-22, HEAD fa3fb4295, `m48_post_on`). With AI on, 2 own foods lost a right parent, sure, and 1 went under a wrong one:

- A lean chicken mince food was under the own food kipgehakt. AI's parent was "chicken mince"; no food is named or spelled that (kipgehakt has only Dutch spellings), so the parent was removed.
- An unflavored protein powder was under protein. AI gave no parent and the category "protein powder"; the own food "protein powder" exists (two flavoured powders went under it in the same pass), but the category was not found, so the parent was removed.
- A bouillon cube got no parent and the category "seasoning", which found mixed spices.

On the copy: 3 foods. Ticket 27 keeps a parent the food shares; here AI names the current parent in other words, and the lookup misses it.

**Blocked by:** None

**Status:** done

## Decided (Mike, 2026-10-23)

"build all except 66". When AI names a parent or a category and the lookup finds nothing, the food keeps the parent it has instead of losing it. A null parent and null category from AI still remove it. The bouillon cube under mixed spices is left.

## Implemented (2026-10-23)

- `readThenLookUp` returns the current parent (`filedUnder.id`) as the "own" answer's `parentId` when AI named a parent or a category and neither lookup found a food; with no parent and no category it is null, so `askAIAbout` still drops the parent. One rule with ticket 65, said in `readThenLookUp`'s doc comment: the current parent stays where AI names it in fewer words or names something the catalogue lacks.
- A kept parent goes through `parentByAI` with the same id: no change recorded, outcome "parent", the flag follows AI's sureness.
- Tests (`review.test.ts`): "keeps the parent when the catalogue lacks the parent AI names" (mager kipgehakt, "chicken mince") and "keeps the parent when the catalogue lacks the category AI names" (unflavoured protein, "protein powder"), which replaces "drops the parent when the catalogue lacks the category too". "drops the parent, listed on Changed by AI to undo" now reads parent null instead of "spread". Release-notes line and ADR-0037 amendment.
- For Mike: this also keeps a wrong parent from the words where AI names an unfound parent: "peanut butter" under butter with AI's parent "spread" (not in the catalogue) now stays under butter; before, ticket 23 dropped it. Only a reading with neither parent nor category drops a parent now.
