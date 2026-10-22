# 50: AI merges a brand product into its general food

**What to build:** Found by ticket 31's run after tickets 32-48 (2026-10-22, HEAD fa3fb4295, `m48_post_on`). Ticket 40 let AI read the own foods whose parent was confirmed in 0.25, and many of those are brand products filed under their general food. AI now reads such a product as the general food itself (English name "cream cheese", "hot sauce") and the pass merges it into that food. In the last run they stayed own foods under it, which the audit counted as filed fine.

- On the production copy: 9 brand products merged into the general food, 6 sure and 3 unsure (about 10 recipe lines). The product's name becomes a spelling of the general food, so it shows as a translation.
- Also doubtful, same shape without a brand: 6 more specific foods merged into the general one (baby potatoes into potato, pumpkin puree into pumpkin, italian sausage into sausage).
- Mike's call: is a brand product its general food (merge is right), or its own food under it (AI should answer "parent", and a merge needs the same product)?

**Blocked by:** None

**Status:** needs-triage
