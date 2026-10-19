# 12: Measure the upgrade on the production copy, with AI off and on

**What to build:** A before-and-after report of what this release does to a real catalogue. Start from the production copy as it stands on 0.25.1, upgrade it to this release twice, once with AI off and once with AI on, and compare both runs with the start.

- **Start:** a clone of `norish_prod_pristine` (production, 2026-10-17). If its migrations are not exactly v0.25.1's, boot v0.25.1 on the clone first. The template itself is never booted.
- **Run A, AI off:** a fresh clone of the start, booted on this release with AI off. Measured once the first start's cleanup has finished.
- **Run B, AI on:** a fresh clone of the start, booted with AI on (the dev AI config re-inserted). Measured once the cleanup and the AI pass over every undecided food have finished.
- **One read-only script** reads the same counts from all three databases.

**What is counted:**

- Ingredients: own and seeded; flagged, by reason; kept distinct; with a parent.
- Spellings: all, and own.
- Recipe lines: naming one food, several (together or alternatives), or none; Headings; lines deleted as Junk Lines.
- Groceries, recurring groceries and Pantry Ingredients that point at no food.
- Joined names still a food of their own.
- Run B only: AI Changes by kind, sure and unsure; the pass's requests and tokens, from the job monitor.
- Runs A and B: how long the first start took.
- The spec's named cases, per database: their lines, foods and spellings. These are "gyoza vellen", "3wu)", "paprika (vrucht)", "zout en peper", "boter of olie", "water of kokosmelk", "juice of a lemon", "mac and cheese", "toilet paper", "deegroller", "melted", "Voor de salade:" and "taart- of springvorm".

Recipe text from production stays out of the repo: only counts and the named cases go in this ticket. Any per-line listing for Mike to read is kept outside the repository.

**Blocked by:** 08, 09

**Status:** ready-for-agent (needs the production MASTER_KEY in `.env.local`, which Mike sets)

- [ ] The start, run A and run B are measured with the same script. A table of the counts (0.25.1 / AI off / AI on) is in this ticket's Comments.
- [ ] Each named case is listed for all three databases.
- [ ] Run B's AI Changes are counted by kind and sureness, with the requests and tokens the pass used.
- [ ] Nothing writes to the template: every run is on its own clone.
- [ ] Every result that looks wrong becomes a ticket of its own, not a fix here.
