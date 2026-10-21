# 26: Unsure merges land on an unrelated food

**What to build:** Found by ticket 12. With AI on, the pass made 5 unsure merges on the production copy. Two of them join a food to an unrelated one: "rode pesto" into red port, and "sriracha sauce" into oyster sauce. Their recipe lines now name the wrong food until someone presses Undo. An unsure answer is applied by design (flagged, with Undo), but these two are not near misses. The others ("koffiewater" into water, "refried beans" into red bean, "tortilla's" into tortilla) are close.

**Why:** AI read "rode pesto" as "red pesto" (under pesto) and "sriracha sauce" as sriracha (under hot sauce), sure. None of its names is a food in the catalogue, so the lookup fell back to a slip of the fingers, which took red port and oyster sauce. With one food found, AI was never asked about it, and the merge was made unsure.

**Fix (Mike, 2026-10-21):** the fuzzy matcher returns a scored list. `nearestSlip` already scores every name in reach (how far apart, from both sides) and then keeps only the nearest, or nothing where two different foods tie. It becomes a list of every food within a slip, with its score, best first; the grocery product rule keeps reading the first.

- The lookup of AI's names gives each food found a score: an exact spelling is 1, a slip its closeness.
- An exact match is taken; slips beside it are ignored.
- Only slips found: they are put to AI as the numbered list, best score first, with "none of these", even when only one was found. The best slip is not taken unasked, since red port was the best slip for "red pesto". One more request per such food (5 on the copy).
- AI off: the best slip, as today.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] "rode pesto" and "sriracha sauce" are not merged into red port and oyster sauce; asked, AI answers none.
- [ ] "tortilla's" is still merged into tortilla.
- [ ] An exact match beside a slip is taken without a second question.
- [ ] All `CONTRIBUTING.md` gates pass.
