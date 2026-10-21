# 26: Unsure merges land on an unrelated food

**What to build:** Found by ticket 12. With AI on, the pass made 5 unsure merges on the production copy. Two of them join a food to an unrelated one: "rode pesto" into red port, and "sriracha sauce" into oyster sauce. Their recipe lines now name the wrong food until someone presses Undo. An unsure answer is applied by design (flagged, with Undo), but these two are not near misses. The others ("koffiewater" into water, "refried beans" into red bean, "tortilla's" into tortilla) are close.

Look at where the target came from (a slip of AI's names is unsure by rule, ticket 15) before choosing a fix.

**Blocked by:** None

**Status:** needs-triage

- [ ] "rode pesto" and "sriracha sauce" are not merged into red port and oyster sauce.
- [ ] All `CONTRIBUTING.md` gates pass.
