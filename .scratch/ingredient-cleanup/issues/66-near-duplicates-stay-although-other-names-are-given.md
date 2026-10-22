# 66: Near-duplicates stay although other names are given

**What to build:** Found by ticket 31's run after tickets 61-64 (2026-10-23, HEAD f7bdd8ae3, `m64_post_on`). Ticket 64's prompt line took other names from 46% to 94% of foods read, and 17 of last run's 37 near-duplicates merge again. But 5 own foods that last run merged, rightly, are own foods again: AI gave other names, and none is the spelling the catalogue holds (another cut word, a plural or singular, another spelling of a place name), so the lookup finds nothing and the food stays under its parent.

On the copy: 5 foods, 9 recipe lines. Near-duplicates in all: 25 of 398 listed own foods, against 37 of 417 last run and 12 of 388 in m54.

To decide: a lookup that finds a food by an other name that is close to a spelling but not equal to it, or near-duplicates left for a person to merge.

**Blocked by:** None

**Status:** needs-triage
