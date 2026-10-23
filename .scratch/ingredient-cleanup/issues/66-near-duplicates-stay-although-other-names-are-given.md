# 66: Near-duplicates stay although other names are given

**What to build:** Found by ticket 31's run after tickets 61-64 (2026-10-23, HEAD f7bdd8ae3, `m64_post_on`). Ticket 64's prompt line took other names from 46% to 94% of foods read, and 17 of last run's 37 near-duplicates merge again. But 5 own foods that last run merged, rightly, are own foods again: AI gave other names, and none is the spelling the catalogue holds (another cut word, a plural or singular, another spelling of a place name), so the lookup finds nothing and the food stays under its parent.

On the copy: 5 foods, 9 recipe lines. Near-duplicates in all: 25 of 398 listed own foods, against 37 of 417 last run and 12 of 388 in m54.

To decide: a lookup that finds a food by an other name that is close to a spelling but not equal to it, or near-duplicates left for a person to merge.

**Blocked by:** None

**Status:** done

## Decided (Mike, 2026-10-23)

"Yes all three and then we have to accept". Build the family question: when AI's names find no food and a parent is found, ask the existing `ingredient-match` question over that parent and its listed children before filing the food under the parent. Evidence (scratchpad near-dup-cause.md): for 19 of m68's 30 near-duplicates the right food is the parent itself (8) or a child of it (11). Measured twice (ticket 31) against the noise band of m70a/m70b (crap 76/84, near-duplicates 34/37); it counts only if it moves clearly outside that band.

## Implemented (2026-10-23)

- `readThenLookUp` (`ai/resolution/ingredient-resolution.ts`): where AI's names find no food and `parentOf` finds a food, `askFamily` asks the existing second question (`askWhich`: Decision, else the `ingredient-match` language model with its per-request enum) over that food and its listed kinds, never the food asked about. A pick merges (`same`), sure as a slip is: the Decision at `SURE_SLIP_THRESHOLD` (0.9), the language model's `sure`; none files the name under the parent as before, its sureness joining the own answer's. No new prompt.
- Kinds: `findListedKindIds(parentId)` (`@norish/db/repositories/ingredient-catalogue`), listed direct children by name. Cap `SHOWN_KINDS` = 10: past ten, the kinds sharing most folded words (name and spellings) with the name as written and AI's names are shown, ties by name; the parent always first.
- Falls out for ticket 65's kept current parent and for a found category too: both are what `parentOf` returns, so no special case keeps them out.
- `findIngredientCandidatesByIds` returns candidates in the order given (the sort moved there from `findNamed`); `askWhich` takes the trace and records what it was asked about.
- Requests: one more Decision request for each food filed under a found parent, plus a language-model request where the Decision falls below 0.8 (or is off). On m70b's readings that is about 330-380 of 574 on the first start (502 readings named a parent or category, about 126 merged by their names).
- Tests: `review.test.ts` "a name AI's names find nothing for, under a parent the catalogue has" (yoghurt griekse stijl into greek yogurt, fijne tuinerwten into garden peas unsure at 0.85, tortillachips naturel into tortilla chips, none files under yogurt, the cap). 18 existing tests queue the family answer (`noneOfTheFamily`); three request counts went 1 to 2. `resolver-ai.test.ts` queues it too. The E2E fake provider needed no change: no E2E reading names a parent the catalogue has.
- Release-notes line beside ticket 56's rule, ADR-0037 amendment. CONTEXT.md unchanged (no term changes).
- Open: whether it moves near-duplicates outside the m70a/m70b noise band is for ticket 31's next two runs.
