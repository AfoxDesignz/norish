# 25: AI deletes a name of two foods, or a grocery's food, as not a food

**What to build:** Found by ticket 12. With AI on, the pass made 3 sure "not a food" changes on the production copy, and all three look wrong:

- two own foods that name two foods with no joining word between them ("salt cinnamon", "koud water melk"). Each had a line, which now names no food. They read as several foods, not as no food.
- an own food a grocery named, which is food by its words ("… reserve eten"). The grocery now points at no food and loses its aisle and price. Mike, 2026-10-20: a non-food purchase stays an Ingredient for its aisle and price, so a grocery's food should not be deleted for this either.

**Blocked by:** None

**Status:** needs-triage

- [ ] A name of two foods with no joining word is split or left, never deleted as not a food.
- [ ] A food a grocery names is not deleted as not a food.
- [ ] All `CONTRIBUTING.md` gates pass.
