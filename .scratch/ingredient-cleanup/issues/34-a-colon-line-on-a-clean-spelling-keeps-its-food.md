# 34: A colon line on a clean spelling keeps its food

**What to build:** Found by ticket 31. After the first start, 1 recipe line ending in a colon still names a food, so ticket 30's "colon line, with a food" row is 1, not 0. The other 10 colon lines pointed at their own colon spelling ("Voor de salade:"), which the cleanup now removes. This one, "Peri peri kruiden:", points at the clean spelling "peri peri kruiden", which other lines also use: the cleanup never removes it, so the line is never resolved again.

- On the production copy: 1 of 11 colon lines.
- To decide: the cleanup also resolves again every line whose own text names no food (`lineNamesNoFood`), whatever its spelling, and raises `CLEANUP_VERSION`.

**Blocked by:** None

**Status:** needs-triage

- [ ] After the first start, no line ending in a colon names a food.
