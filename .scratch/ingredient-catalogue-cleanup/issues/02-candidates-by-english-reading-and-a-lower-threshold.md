# 02: Candidates by English reading, a lower Decision threshold, and the before/after count

**What to build:** settling misses clear cases because the right food is never among the candidates (they are only foods sharing a four-letter word start), or because the Decision acts only at 0.8. Find candidates by AI's English reading too, act on a Decision at 0.5, and measure the result on the Italian import. See the spec, item 2.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] **Candidates by English reading.**
  - Every settle asks for the English reading first and adds the foods holding it (`findIngredientsNamed`, exact fold) to the word-start candidates, as `thorough` mode already does.
  - "No candidates, so AI is not asked" (`unknown-food`) only applies when the English reading also finds nothing.
- [ ] **The threshold.** `RESOLUTION_THRESHOLD` and the two-way `decideBetween` act at 0.5, the pick outweighing every other option together, with a test at the boundary (Clear Case). ADR-0035 says thresholds are code, never settings.
- [ ] **The check.**
  - Reset the dev database (see memory `mike-dev-account` for the wipe recipe), import the same Italian archive with AI on, and record the counts before this ticket and 01 land and after.
  - Record flags by reason, mints, merges and the per-recipe save time.
  - Write the numbers in this ticket's Comments.

## Comments
