# 73: A parent AI names that finds nothing leaves the food without one

**What to build:** Found by ticket 31's same-code runs (2026-10-23, HEAD cce7f83de, `m70a_post_on` and `m70b_post_on`). With one judge, 23 listed own foods in both runs have no parent while the catalogue has an obvious one: the second-largest group after near-duplicates. Often AI names a parent or category the catalogue has under another wording ("spread", "seasoning"), so the lookup finds nothing and the food stays without a parent (ticket 53's shape).

**Blocked by:** 66 (shares its match question)

**Status:** ready-for-agent

## Decided (Mike, 2026-10-23)

"Yes all three and then we have to accept". First check on the 23 foods of m70a/m70b which candidates would have held the right parent; build the lean version of ticket 66's question for parents only if one candidate source covers most of them, otherwise record why and leave it. Measured twice against the m70 band like 66.
