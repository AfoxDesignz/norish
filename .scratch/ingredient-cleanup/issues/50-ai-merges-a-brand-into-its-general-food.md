# 50: AI merges a brand product into its general food

**What to build:** Found by ticket 31's run after tickets 32-48 (2026-10-22, HEAD fa3fb4295, `m48_post_on`). Ticket 40 let AI read the own foods whose parent was confirmed in 0.25, and many of those are brand products filed under their general food. AI now reads such a product as the general food itself (English name "cream cheese", "hot sauce") and the pass merges it into that food. In the last run they stayed own foods under it, which the audit counted as filed fine.

- On the production copy: 9 brand products merged into the general food, 6 sure and 3 unsure (about 10 recipe lines). The product's name becomes a spelling of the general food, so it shows as a translation.
- Also doubtful, same shape without a brand: 6 more specific foods merged into the general one (baby potatoes into potato, pumpkin puree into pumpkin, italian sausage into sausage).
- Mike's call: is a brand product its general food (merge is right), or its own food under it (AI should answer "parent", and a merge needs the same product)?

**Blocked by:** None

**Status:** needs-triage

## Brand half: decided (Mike, 2026-10-22)

A brand product is its general food, so the merge is right. Nothing to build for the brands. AI gives the general name as the English name ("Monchou roomkaas" is "cream cheese", "Franks Hot Sauce" is "hot sauce"), and that name finds the food.

## Specific foods: findings (2026-10-22)

"First find out before anything is built." Taken from `m48_post_on`, `norish_prod_pristine` and `server-48.log`. The run notes named 3 of the 6; the other 3 here are the merges into the food's own 0.25 parent that are a narrower food, not a brand or a form. Fat-free greek yogurt and red pepper flakes are added because they merged the same way.

| Food → merged into | AI's reading (all sure, category none) | What found the target | Cause | Lines |
|---|---|---|---|---:|
| baby potatoes → potato | "baby potatoes", parent potato, other names "mini potatoes", "petite potatoes" | the other name "petite potatoes" read as "potatoes" ("petite" is a French size word), a seeded spelling of potato | b | 13 |
| mini-krieltjes → potato | "baby potatoes", parent potato, other names "small potatoes", "petite potatoes" | the other name "small potatoes" read as "potatoes" ("small" is a size word) | b | 1 |
| canned petite diced tomatoes → tomato | itself, parent tomato, other names "canned diced tomatoes", "petite diced tomatoes" | the other name "petite diced tomatoes" read as "tomatoes" (size "petite", preparation "diced") | b | 3 |
| deli ham → ham | itself, parent ham, other names "sliced ham", "lunch meat ham" | the other name "sliced ham" read as "ham" (preparation "sliced") | b | 1 |
| pumpkin puree → pumpkin | itself, parent pumpkin, other names "pumpkin purée", "pureed pumpkin" | "pureed pumpkin", an own spelling pumpkin already held in 0.25 | c (own spelling) | 5 |
| italian sausage → sausage | "Italian sausage", parent sausage, other names "Italian-style sausage", "salsiccia" | "salsiccia", sausage's seeded Italian spelling | c (seeded spelling) | 1 |
| fat free plain greek yogurt → greek yogurt | "fat-free plain Greek yogurt", parent Greek yogurt, other names "nonfat plain Greek yogurt", "fat-free Greek yogurt" | "fat-free Greek yogurt", an own spelling greek yogurt already held in 0.25 | c (own spelling) | 4 |
| red pepper flakes → red bell pepper (a different food) | itself, parent chili pepper, other names "crushed red pepper", "red chili flakes" | the other name "crushed red pepper" read as "red pepper" (preparation "crushed"), a seeded spelling of red bell pepper | b | 7 |

- **Not (a).** AI read every one correctly: the English name is the specific food (the food's own name, which the lookup skips), and the parent is the general food. The merge comes only from an **other name**, so this is ticket 39's shape (other names are taken exactly, no second question). Ticket 32's name-first lookup found none of them, and no slip was involved.
- **No second question ran** for any of them. No Decision or language-model pick names these foods in the log. Each found one food exactly, and `findNamed` asks only when it finds several exact foods or only slips. Sure = reading sure and an exact find. `review.ts` turns `same` into `mergeByAI`. The spelling check later kept the moved spellings on potato, pumpkin and greek yogurt (`this-food`).
- **Root cause 1 (b), 5 of 8:** `findNamed` looks AI's other names up through rungs 1-2 (`findOtherFoodsNamed` → `matchKnown`: fold, then bare, then plain fold). The plain fold drops size and preparation words, and the size words are pooled across all languages (French "petite" strips English "petite potatoes"). So a specific other name becomes the general food's own seeded spelling. Ticket 20's forms list does not do this ("puree" is not a form).
- **Root cause 2 (c), 3 of 8:** the general food already holds a spelling of the specific food. Two are own spellings from 0.25 recipe lines ("pureed pumpkin" on pumpkin, "fat free greek yogurt" on greek yogurt). One is a seeded foreign word ("salsiccia" on sausage). AI lists that spelling as an other name, and it matches exactly.
- Open for Mike: is a more specific food (baby potatoes, pumpkin puree, italian sausage) its general food like a brand, or its own food under it? If it is its own food, the narrowest fix for root cause 1 looks other names up by their full spelling only (fold and bare, no plain fold). That leaves root cause 2, the general food holding the specific spelling, which belongs with ticket 52.
