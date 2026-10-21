# 35: AI drops a parent that is a category

**What to build:** Found by ticket 31. With AI on, the pass dropped 12 parents as sure changes (ticket 23). Half look wrong: "chinese 5 spice" from spice, "Cajun seasoning" from mixed spices, "ranch seasoning" from mixed condiments, "harissa kruiden" and "bagel everything kruiden" from herb, and "adobo sauce" from sauce (6). The others look right ("Klop-Fix" from fish, "bone-in short ribs" from bone, "nut butter" from butter, and 3 more). Ticket 27's check "chinese 5 spice keeps spice" does not hold.

**Why:** ticket 27's prompt asks `parent` as a plain food a shopper buys, never a category. A spice blend's right parent in the catalogue is a category food (spice, mixed spices from ticket 21, sauce), so AI answers null, and null drops the parent.

- On the production copy: 12 parents dropped, 6 look wrong; ticket 12's run dropped 4 (3 wrong).
- To decide: the prompt allows a shown parent that is the catalogue's general food for blends and sauces, or a null `parent` keeps a parent the food shares a word with ("spice", "sauce", "seasoning" → mixed spices).

**Blocked by:** None

**Status:** needs-triage

- [ ] "chinese 5 spice", "Cajun seasoning" and "adobo sauce" keep their parents.
- [ ] "Klop-Fix" and "bone-in short ribs" still lose theirs.
