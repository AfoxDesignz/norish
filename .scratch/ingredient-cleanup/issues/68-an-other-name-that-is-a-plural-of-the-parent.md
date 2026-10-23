# 68: An other name that is a plural of the parent counts as the parent

**What to build:** Left open by ticket 63 (2026-10-22). Ticket 63 merges a food into its parent when one of AI's other names folds equal to the parent AI gives. A plural ("guajillo chilies" for parent "guajillo chili") is compared as text and does not count.

**Blocked by:** None

**Status:** ready-for-agent

## Decided (Mike, 2026-10-23)

A plural counts. The other name and the parent are compared with the slip matcher (`name-slips.ts`) the lookup already uses, not a plural rule of its own. Checked on 2026-10-23: it takes "guajillo chilies", "onions", "tomatoes" and "red bell peppers", and misses short or irregular ones ("eggs", "chilies", "bay leaves", "cherries"); those stay as ticket 63 has them.
