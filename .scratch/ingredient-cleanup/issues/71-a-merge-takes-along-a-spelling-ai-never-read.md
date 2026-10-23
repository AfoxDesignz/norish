# 71: A merge takes along a spelling AI never read

**What to build:** Found by ticket 31's run after tickets 51-53, 65, 67, 68 and ticket 60's round 2 (2026-10-23, HEAD 814c23937, `m68_post_on`). AI read an own brand food's short name as plain noodles, sure, and merged it into seeded noodle. Its spellings went along, and one of them, the longer product name, is a noodle seasoning mix (AI read it that way, unsure, last run). Ticket 51 now leaves out the spellings a merge moved in, so the spelling check no longer takes it off noodle, and its line names noodle. Last run the check took both spellings off.

On the copy: 1 food, 1 recipe line; noodle holds the 2 spellings.

To decide: AI's merge reads the spellings it moves, or the spelling check still reads moved spellings that differ from the name AI read.

**Blocked by:** None

**Status:** needs-triage
