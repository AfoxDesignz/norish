# 64: The reading still gives other names for under half of foods

**What to build:** Found by ticket 31's run after tickets 57, 58 and 60 (2026-10-22, HEAD 67eb2082a, `m60_post_on`). Ticket 58 put the old `otherNames` description back in the reading schema. Other names came back halfway: 276 of 601 foods read have them (46%), against 71% in m54 (the old prompt) and 29% in m56. Ticket 58's parent change held: no powder lost its specific parent.

Without other names the pass does not find the existing food, so own foods that should merge stay own foods under a general food:

- 18 of the 39 near-duplicates ticket 58 counted are still own foods.
- 6 own foods that last run merged, rightly, are own foods now (11 recipe lines): AI gave no other names, or other names that find nothing.
- Near-duplicates in all: 37 of 417 listed own foods, against 12 of 388 in m54.

The prompt text stays word for word (Mike, ticket 58), so the levers left are the schema's descriptions or a lookup that does not lean on other names.

**Blocked by:** None

**Status:** needs-triage
