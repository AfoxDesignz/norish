# 21: Seasonings are mixed spices

**What to build:** Open Food Facts' "coating" mixes two foods. Its spellings "seasoning", "sazonador", "fűszerezés" and "シーズニング" (and any other that means seasoning, not a coating) move to the seeded **mixed spices** ("gemengde specerijen", "Gewürzmischung"), which already holds garam masala, ras el hanout and shawarma spices. "taco seasoning", "cajun seasoning" and "ranch seasoning" are then filed under mixed spices instead of coating (Mike, 2026-10-20).

- **The correction outlives the nightly fetch:** the seed is fetched from Open Food Facts every night, so a spelling move is applied as the taxonomy is read, from a short list of corrections kept with the seed. This is the first entry on that list.
- **Existing foods:** a food the words filed under coating through "seasoning" is filed under mixed spices on the first start, unless a person chose its parent.
- Coating keeps its coating spellings ("enrobage", "Überzug", "nappage", "rivestimento").

**Blocked by:** None

**Status:** ready-for-agent

- [ ] A new "taco seasoning" is filed under mixed spices, quietly, as a parent whose spelling ends the name is.
- [ ] After a nightly seed, "seasoning" is still a spelling of mixed spices, not of coating.
- [ ] An existing "cajun seasoning" filed under coating is under mixed spices after the first start; one a person filed elsewhere stays.
- [ ] All `CONTRIBUTING.md` gates pass.

## Comments

Measured on ticket 16's set: 18 names were filed quietly under coating, 10 of them through "seasoning". The other 8 are "… voor de coating" and "… for the coating" notes, which ticket 20 fixes.
