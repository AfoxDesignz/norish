# 51: The spelling check reads a merge from the same start, and a comma fragment alone

**What to build:** Found by ticket 31's run after tickets 32-48 (2026-10-22, HEAD fa3fb4295, `m48_post_on`). Ticket 46's spelling check asked 252 seeded foods and changed 9 spellings. Two of the results are wrong:

- **A merge from the same start is undone.** The first pass merged an own brand food into seeded noodle, unsure (its spellings moved onto noodle, noodle flagged). The spelling check then ran on noodle, read those 2 spellings as another food, and removed them. Their line was minted again, renamed, and filed, sure, under mixed spices. On the copy: 1 food, 1 line; the merge still shows as an open AI Change, noodle stays flagged, and the new parent is wrong. To decide: the spelling check skips spellings an AI Change moved in (they are AI's already), or runs before the pass.
- **A comma fragment is judged by its words.** "organic plain" (cut from a Greek yogurt line at the comma in 0.25) was moved from greek yogurt to plain yogurt, so the line left the right food. On the copy: 1 spelling, 1 line. The check shows AI the spelling without the line it came from.

**Blocked by:** None

**Status:** needs-triage
