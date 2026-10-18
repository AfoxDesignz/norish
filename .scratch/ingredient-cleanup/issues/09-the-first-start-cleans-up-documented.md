# 09: The first start cleans up, documented

**What to build:** When a server first starts this release, one pass cleans what earlier versions left. It runs at startup after the seed, once per cleanup version recorded in the ingredient seed state, the same way the recheck pass is versioned:

1. Seeded spellings lose their stray marks ("3wu)", "|चौलाई}}"). Balanced brackets stay.
2. A dirty translation whose fold is already clean ("gyoza vellen )", "baking soda )") gets its clean text.
3. Every non-seeded translation that is not its own clean name ("gyoza vellen ((ontdooid))") is removed. The rows behind it are re-resolved from their own text with AI off. Old hand-typed translations can't be told apart from minted ones, so they are treated alike.
4. Colon lines with no amount ("Voor de salade:") become Headings.
5. Joined names on recipe lines, Pantry Ingredients and recurring groceries are split by the words, and the joined food is removed, even one a person kept distinct.
6. The AI pass is queued for every own food no person has decided about.

Then the docs:
- the target version's release notes, with an upgrade note saying this runs by itself and deletes junk lines;
- the release notes also name ticket 02's changes: delete always works (the dialog's counts), own foods unused for 30 days are deleted nightly, and groceries can repeat yearly;
- the Ingredients page in the docs, rewritten for applied changes, Changed by AI and delete;
- screenshots shot as whole panel windows off a running instance.

**Blocked by:** 01, 02, 05, 07, 08

**Status:** ready-for-agent

- [ ] A scenario modelled on the production data covers each step: "gyoza vellen )", "gyoza vellen ((ontdooid))", "3wu)", "paprika (vrucht)", "Voor de salade:", "zout en peper" kept distinct, an undecided own food.
- [ ] The pass runs once; a second start does nothing.
- [ ] Run on a copy of the production database (reset from the pristine template, with the production MASTER_KEY): spellings drop from about 71,600 to the clean set; "gyoza vellen" shows one translation; the 11 colon lines are Headings; no joined food remains; AI Changes appear for the undecided foods. Report the before and after counts in this ticket's Comments.
- [ ] Release notes, the upgrade note and the Ingredients docs page are updated. Changed by AI and the delete dialog have fresh screenshots. No real people's names appear in them.
- [ ] All `CONTRIBUTING.md` gates pass, and the docs site builds.
