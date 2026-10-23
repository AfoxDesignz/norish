# 76: AI gives several parents, in English and in the name's language

**What to build:** Ticket 73's analysis (2026-10-23): of the 23 listed own foods without a parent in m70a/m70b, 15-17 have a parent AI named that the catalogue holds under another wording ("salad dressing" for dressing, "bun" for bread roll, "spice mix" for mixed spices, "bouillon cube" for broth) or only in Dutch (kipgehakt, zoete aardappel friet, ingelegde rode ui). AI gives one English parent, so one wording decides.

**Blocked by:** None

**Status:** ready-for-agent

## Decided (Mike, 2026-10-23)

"perhaps make it give back a couple of parent options so we can test multiple... parents become an array and we have native parents as well... we just need to change the json a bit." And: "if both match we prefer native."

- The reading's `parent: string | null` becomes `parents: string[]`, two or three wordings, the most specific first, and gains `nativeParents: string[]`, the same in the name's own language. Rules stay in the fields' `.describe()`; the prompt text stays lean (only where it names the field).
- The parent lookup tries the native parents first, then the English ones, in AI's order: the first that finds a food is the parent. Through the existing lookup (`parentOf` → `findByName`/`findFood`), one query for all names.
- Every rule that compares with AI's parent compares with any of them: ticket 63's other name that is the parent (`sameFood`/`wholeFoodKey`), ticket 65's last words of the current parent, ticket 56/57's found food that is the parent, ticket 53's kept AI parent. The category stays as it is.
- No extra AI request. Measured in the final run by the named foods (mager kipgehakt, ovenfriet zoete aardappel, zoetzure rode ui, the "bun"/"spice mix"/"bouillon cube"/"salad dressing" cases), not by the total, which moves within its noise band.
