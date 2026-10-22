# 63: An other name that is the parent's spelling keeps the same food under it

**What to build:** Found by ticket 31's run after tickets 57, 58 and 60 (2026-10-22, HEAD 67eb2082a, `m60_post_on`). Ticket 57 narrowed ticket 56's rule to a food that AI's other names or a slip find and that is the reading's parent: that food becomes the parent, never the merge target. Here AI read a plural own food with a parent that is the same food in the singular, and gave that parent's seeded spelling as an other name. The rule filed it under the parent, so the copy keeps a near-duplicate. Last run, with the parent one level up, it merged.

On the copy: 1 food, 3 recipe lines.

To decide: is an other name that is the parent's own spelling, with nothing in the English name to tell them apart, AI saying "this is that food" (merge), or does ticket 57's rule stand?

**Blocked by:** None

**Status:** needs-triage
