# 33: A last word read in the singular finds a two-letter spelling of another language

**What to build:** Found by ticket 31. The first start's recheck filed "Nora reserve eten", a grocery food, under meat (`filed: 1`). Ticket 28 took away the pepper its first word gave, but the words still read the last word "eten" in the singular, "et", and "et" is meat's Turkish seed spelling. The food is hidden (ticket 25), so AI never asks about it and nothing corrects the parent. Ticket 28's check "gets no parent from its words" does not hold.

- On the production copy: the only food the recheck filed (1 of 1). No AI Change is recorded, since a words parent is not AI's.
- The reading is `parentFromWords` → `inflectedReadings` in `packages/shared-server/src/ingredients/resolver.ts`; the seed lookup is `findSeededFoodSpellingsByFolds`.
- To decide: a minimum length for a singular reading, the singular only of a word in the language whose plural rule made it, or the recheck leaving hidden foods alone.

**Blocked by:** None

**Status:** needs-triage

- [ ] "Nora reserve eten" gets no parent from its words.
