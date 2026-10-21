# 24: A colon line keeps the food an old spelling gave it

**What to build:** Found by ticket 12. On the production copy, 11 recipe lines that end in a colon ("Voor de salade:") still name a food after the first start's cleanup, with AI off and on. This release names no food for a colon line it resolves, but the cleanup's step 3 gives the spelling "Voor de salade:" its clean text "Voor de salade" in place, so the line keeps lettuce. The spec's Problem Statement names these 11 lines as wrong.

**Blocked by:** None

**Status:** needs-triage

- [ ] After the first start, no line ending in a colon names a food; its text is unchanged.
- [ ] All `CONTRIBUTING.md` gates pass.
