# 62: A plain name that differs only in case renames the food

**What to build:** Found by ticket 31's run after tickets 57, 58 and 60 (2026-10-22, HEAD 67eb2082a, `m60_post_on`). AI's plain name for an own food was the food's own name in lower case. `giveItsPlainName` compares it with `===`, so the two count as different, the lookup finds no other food, and `renameByAI` renames the food to the lower-case copy as a sure AI Change.

On the copy: 1 food, the run's only plain-name change.

To decide: does a plain name equal to the name but for case settle the name (as an equal one does), or keep the person's casing some other way?

**Blocked by:** None

**Status:** needs-triage
