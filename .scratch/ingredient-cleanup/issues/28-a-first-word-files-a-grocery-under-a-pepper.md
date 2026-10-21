# 28: A first word that is a seeded spelling files a food under it

**What to build:** Found by ticket 12. With AI off, the first start's recheck filed an own food a grocery named under spicy red pepper, as an unsure parent from its words: the name starts with a name that, once folded, is a seeded spelling of a pepper, followed by "reserve eten". The flag and Undo catch it, but the words should not have given that parent. With AI on, AI then deleted the food as not a food; ticket 25 hides it instead.

**Fix (Mike, 2026-10-21):** the unsure parent from the words goes. A parent comes from the words only where its spelling ends the name ("ground cumin" under cumin), or starts it before cuts and forms alone ("mango blokjes" under mango). A spelling anywhere else gives no parent. On the production copy that guess filed one food, this wrong one. Ticket 22's four-letter rule only served that guess and goes too; its cases ("olie om te bakken", "raw king prawns") then get no parent at all. With AI on, AI files the parent. `RUNG_VERSION` goes up, so the startup recheck files old mints again.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] "Nora reserve eten" gets no parent from its words.
- [ ] "ground cumin" stays under cumin and "mango blokjes" under mango.
- [ ] All `CONTRIBUTING.md` gates pass.
