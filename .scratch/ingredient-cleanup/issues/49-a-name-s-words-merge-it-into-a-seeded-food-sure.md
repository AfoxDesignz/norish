# 49: A food's own words merge it, sure, into a seeded food that is another food

**What to build:** Found by ticket 31's run after tickets 32-48 (2026-10-22, HEAD fa3fb4295, `m48_post_on`). With AI on, the own food "red pepper flakes" was merged, sure, into seeded red bell pepper. AI read it right (English name "red pepper flakes", parent chili pepper, other names crushed red pepper and red chili flakes). The lookup of those names found red bell pepper with no candidate shown to the second question (`considered` is empty), so it counted as an exact find. Red bell pepper holds the seeded English spelling "red pepper"; no food spells any of AI's names. The own food "chili flakes", which its three copies merged into in the same pass (ticket 40), was not found.

- On the production copy: 1 sure merge, 7 recipe lines now on red bell pepper, and red bell pepper holds the spelling "red pepper flakes". Ticket 40's check (red pepper flakes leaves red bell pepper) does not hold.
- To trace: which reading in `findOtherFoodsNamed` / `matchKnown` (bare, plain or inflected fold) turns "red pepper flakes" into "red pepper", and whether a find by a shortened reading should be put to the second question instead of counting as exact.

**Blocked by:** None

**Status:** needs-triage
