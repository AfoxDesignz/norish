# 25: AI deletes a name of two foods, or a grocery's food, as not a food

**What to build:** Found by ticket 12. With AI on, the pass made 3 sure "not a food" changes on the production copy, and all three look wrong:

- two own foods that name two foods with no joining word between them ("salt cinnamon", "koud water melk"). Each had a line, which now names no food. They read as several foods, not as no food.
- an own food a grocery named, which is food by its words ("… reserve eten"). The grocery now points at no food and loses its aisle and price. Mike, 2026-10-20: a non-food purchase stays an Ingredient for its aisle and price, so a grocery's food should not be deleted for this either.

**Fix (Mike, 2026-10-21):** nothing to build here. The two foods side by side are split through ticket 31's answer; the grocery's food is hidden and never asked through ticket 32. In the run, AI read all three as "not a food" while unsure. Ticket 33 checks them.

**Blocked by:** 31, 32

**Status:** ready-for-agent

- [ ] "salt cinnamon" and "koud water melk" are split, not deleted (ticket 31).
- [ ] "… reserve eten" is hidden and never asked (ticket 32).
