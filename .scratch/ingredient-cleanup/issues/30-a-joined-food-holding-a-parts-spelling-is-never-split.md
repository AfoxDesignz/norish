# 30: A joined food holding one part's spelling is never split

**What to build:** Found by ticket 12. With AI on, AI read "light cooking cream or non-fat Greek yogurt" as two alternatives, sure. The pass still flagged it unsure and left it whole. The food also carries the spelling "light cooking cream", so that part resolves to the food itself, and a split whose part is the food is refused. Its lines keep naming one joined food.

**Fix (Mike, 2026-10-21):** the part's spelling moves from the joined food to a new food of its own, and the split goes ahead.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] A sure split of a joined food that holds one part's spelling makes the split, and that part gets a food of its own.
- [ ] All `CONTRIBUTING.md` gates pass.
