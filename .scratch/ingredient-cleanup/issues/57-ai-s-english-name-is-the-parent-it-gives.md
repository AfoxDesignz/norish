# 57: AI's English name is the parent it gives, so a food stays its own food under itself

**What to build:** Found by ticket 31's run after ticket 56 (2026-10-22, HEAD 44297d433, `m56_post_on`). Ticket 56's rule files a name under AI's parent when AI's names find that same food. It was meant for an other name that happens to be the parent's spelling (italian sausage, "salsiccia"). It also fires when AI's English name itself is a spelling of the parent, and then the reading says the food is its own parent:

- 4 own foods whose English name is a seeded spelling of the parent AI gave (a Dutch "edamame beans" under edamame, "flour tortilla" under wheat tortilla, "smoked paprika powder" under smoked paprika, "chorizo sausage" under chorizo). Last run merged all 4, sure. 8 recipe lines now name a near-duplicate.
- 4 brand products whose English name and parent are both the general food (hot sauce, cream cheese, pesto, margarine). Ticket 50 decided these merge into the general food; ticket 56's note expected the `parent` describe to keep AI from naming the brand's own food as its parent, and here it does not. Last run merged 3 of them, sure. 5 lines.

To decide: does the rule hold only for an other name (the English name finding the parent still merges), or does a reading whose English name finds the parent count as AI saying "this is that food"?

**Blocked by:** None

**Status:** needs-triage
