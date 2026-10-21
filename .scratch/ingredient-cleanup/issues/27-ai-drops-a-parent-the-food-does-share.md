# 27: AI drops a parent the food does share

**What to build:** Found by ticket 12. With AI on, the pass dropped 4 parents on the production copy as sure changes (ticket 23's "no general food"). One drop is right ("Denta tix" from tea). Three are wrong: "chocolate whey" from whey, "Italian herbs" from herb and "chinese 5 spice" from spice. The words gave each a parent that is the general food.

**Why:** AI named a category as the general food: "whey protein powder", "herb seasoning", "spice blend". No food in the catalogue has that name, so the code read it as no general food and dropped the parent (ticket 23).

**Fix (Mike, 2026-10-21):** AI keeps to the facts.

- The prompt asks each food's `parent` (ticket 31) as a plain food a shopper buys, the base food it is made of or sold as: "chocolate whey" is whey, "Italian herbs" is herbs, "rode uien" is onion. Never a category ("spice blend", "dog treats"); null when there is none.
- The question shows the parent the food has now ("Filed under: whey"), so AI judges a real parent instead of making one up.
- The code looks the answer up as today. No check on shared words.

**Blocked by:** 31

**Status:** ready-for-agent

- [ ] "chocolate whey", "Italian herbs" and "chinese 5 spice" keep their parents.
- [ ] "Denta tix" still loses tea.
- [ ] All `CONTRIBUTING.md` gates pass.
