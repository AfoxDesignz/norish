# 70: A parent merged away while the reading is out is dropped

**What to build:** Found by ticket 31's run after tickets 51-53, 65, 67, 68 and ticket 60's round 2 (2026-10-23, HEAD 814c23937, `m68_post_on`). A food sat under an own food. While AI was reading the food, a parallel job merged that own parent, sure and rightly, into a seeded food, so the food moved under the seeded food. AI then named the old parent, and ticket 65's rule answered with the parent row `askAIAbout` loaded before the reading. That row was gone by then, so `findCatalogueIngredient` found nothing, and the pass took the answer as "no parent" and removed the seeded parent the food now had, sure. Last run the two readings ran in the other order and the food kept its parent.

On the copy: 1 food, 1 recipe line.

To decide: an answer whose parent is gone is looked up again, or the food is left as it is.

**Blocked by:** None

**Status:** needs-triage
