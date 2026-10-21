# 32: AI's English name finds a food by another language's spelling

**What to build:** Found by ticket 31. With AI on, the pass filed "Hero Bosvruchtenjam" under yam, as a sure parent. AI's parent was "jam", in English. The catalogue has no English food called jam, but the seed holds "jam" as yam's Croatian spelling, and an exact spelling of AI's names is taken without a second question (ticket 26). So an English answer lands on whatever food some other language spells the same way.

- On the production copy: 1 of 36 parents AI set (35 sure, 1 unsure); none of the 27 merges came this way.
- The lookup is `findNamed` / `findOtherFoodsNamed` (resolver, `review.ts`); a seed spelling stores one locale (`ingredient_aliases.locale`, "hr" here).
- To decide: whether AI's English names look only at English and own (null locale) spellings, or whether a find in another language counts as a slip and goes to the second question.

**Blocked by:** None

**Status:** needs-triage

- [ ] "Hero Bosvruchtenjam" is not filed under yam.
