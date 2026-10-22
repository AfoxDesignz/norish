# 57: AI's English name is the parent it gives, so a food stays its own food under itself

**What to build:** Found by ticket 31's run after ticket 56 (2026-10-22, HEAD 44297d433, `m56_post_on`). Ticket 56's rule files a name under AI's parent when AI's names find that same food. It was meant for an other name that happens to be the parent's spelling (italian sausage, "salsiccia"). It also fires when AI's English name itself is a spelling of the parent, and then the reading says the food is its own parent:

- 4 own foods whose English name is a seeded spelling of the parent AI gave (a Dutch "edamame beans" under edamame, "flour tortilla" under wheat tortilla, "smoked paprika powder" under smoked paprika, "chorizo sausage" under chorizo). Last run merged all 4, sure. 8 recipe lines now name a near-duplicate.
- 4 brand products whose English name and parent are both the general food (hot sauce, cream cheese, pesto, margarine). Ticket 50 decided these merge into the general food; ticket 56's note expected the `parent` describe to keep AI from naming the brand's own food as its parent, and here it does not. Last run merged 3 of them, sure. 5 lines.

To decide: does the rule hold only for an other name (the English name finding the parent still merges), or does a reading whose English name finds the parent count as AI saying "this is that food"?

**Blocked by:** None

**Status:** done

## Decided (Mike, 2026-10-22)

The rule overshoots: "a food is never merged into the parent AI gave it" does not hold when AI's English name is the parent itself. Then the name is that food and it merges (englishName "chicken thigh", parent "chicken thigh" merges into chicken thigh).

## Implemented (2026-10-22)

- `readThenLookUp` in `packages/shared-server/src/ai/resolution/ingredient-resolution.ts` skips the parent lookup (`ownParent`) when `namesTheSame(food.englishName, food.parent)`: both folded with `ingredientAliasFold`, as alias names are compared. The found food is then merged into as before ticket 56.
- Only an English name equal to the parent counts. A reading whose English name is another seeded spelling of the parent ("edamame beans" under edamame, "chorizo sausage" under chorizo) still stays its own food under that parent; so do pumpkin puree, italian sausage and Tenderstem broccoli. The brand products (hot sauce, cream cheese, pesto, margarine) merge where AI gives the general food as both English name and parent.
- Test: `review.test.ts` "merges kippendijen into chicken thigh, the parent AI gives being its English name" (English name "Chicken thigh", parent "chicken thigh": folded alike).
- Release-notes line and the ADR-0037 ticket-56 amendment say the exception.
