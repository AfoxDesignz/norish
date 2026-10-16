# 09: Fix catalogue re-checks every food not from the seed

**What to build:** AI looks only at new and flagged foods by itself. An unflagged food is taken to be clean. Fix catalogue gains the one way back in: a person asks AI to re-check every food in the Ingredient Catalogue that is not from the seed, flagged or not. Sure answers are applied whatever was decided before. Mike, 2026-10-16: "we can assume these are clean unless the user specifically asks the whole library". See ADR-0037 (amended 2026-10-16) and the Flagged Ingredient entry.

**Blocked by:** 01, 02, 05, 07

**Status:** ready-for-agent

- [ ] **The Fix catalogue dialog** gains a choice, "Re-check every ingredient not from the seed", with its count and token estimate (`reviewScope`).
  - It covers catalogue foods only (ticket 07). Grocery-only foods are never asked.
- [ ] **Each food is asked as settling asks** (01, 02, 05), and a sure answer is applied:
  - **same as:** merge, into any food.
  - **several foods:** split, even if a person kept it as one food or marked it distinct.
  - **names no food:** applied when only recipe lines name it.
  - **a kind of:** set the parent, unless a person chose one.
  - **unsure:** a suggestion. The food is not flagged for it, because it was clean.
  - A name a person gave stays: a merge keeps the surviving food's name, and AI never renames.
- [ ] **The report** lists every merge and split, so a wrong one can be moved back out.
  - Remembering two foods a person separated is left out until a re-check is seen re-merging them.
- [ ] **`kept_distinct`.** Every person's decision now clears the flag, and AI only acts on flagged foods outside a re-check. Find what still reads `kept_distinct` (the recheck pass, `fileUndecidedMint`); if the flag covers it, drop the column in a migration.
- [ ] **Tests:**
  - the scope counts unflagged minted catalogue foods and leaves out seeded and grocery-only ones;
  - a renamed, parent-chosen or kept-distinct food is merged on a sure answer;
  - a chosen parent and name survive;
  - an unsure answer leaves a suggestion and no flag.

## Comments
