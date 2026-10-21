# 31: Measure the fixes on the production copy

**What to build:** Ticket 12's run of this release with AI on, again on a fresh clone of `norish_prod_pristine`, once tickets 24 to 30 are done. Before the first start the clone clears every Keep distinct mark, all of them (`update ingredients set kept_distinct = false`), so AI asks those foods too. Mike, 2026-10-21: only on this test clone, never in a person's database or in the product. Read with `measure-12/measure.mjs` and compared against ticket 12's table. The same rules as ticket 12: nothing writes to the template, recipe text stays out of the repo, and every result that looks wrong becomes a ticket of its own.

**The report (Mike, 2026-10-21):** `measure.mjs report` writes one HTML page to read in a browser, from the run files. It holds production text, so it is written outside the repository, beside the private listing, and never published. Three columns side by side: before (the clone with its marks cleared, before the first start), ticket 12's 0.26 AI-on run, and after. Every useful before and after statistic:

- **Foods:** all, own, seeded, flagged, kept distinct, with a parent; spellings, all and own; joined own foods.
- **Flagged foods:** the count by reason, and each flagged food's name, before and after.
- **Recipe lines:** headings, colon lines with a food, lines with no food, one food, several (together and alternatives); groceries, recurring groceries and pantry rows with no food.
- **Hidden:** grocery foods and foods nothing names (ticket 25).
- **AI Changes:** by kind and sure, and each one as food → what it became.
- **The first start:** each cleanup step's count and time, the AI pass's time, and requests and tokens by model.
- **Named cases:** ticket 12's 13 cases and the cases from tickets 24 to 30, each with its lines and foods, and whether the ticket's check now holds.

**Blocked by:** 24, 25, 26, 27, 28, 29, 30

**Status:** done

- [x] The report page is written outside the repository, with the three columns and every statistic above.
- [x] The compare table's counts are in this ticket too; names and lines only in the page.
- [x] Each case from tickets 24 to 30 shows as holding or not, including "salt cinnamon", "koud water melk" and "… reserve eten".
- [x] Flagged foods are counted before and after, by reason, with their names in the page.
- [x] Requests and tokens are counted.

## Implemented (2026-10-21)

- **How:** HEAD aba4ef0d5. A fresh clone `m31_post_on` of `norish_prod_pristine` in `norish-db-local`, every Keep distinct mark cleared on the clone only (129 marks), measured, then booted once from a detached worktree with AI on (the copy's own production config: OpenAI gpt-6-luna, Jev) and its own Redis, and measured again once the review and icon queues had been idle a minute. The clone is left in place. The ticket 12 column re-reads `m12_post_on` now; its AI use and first-start numbers are copied from ticket 12 (its Redis is gone), so its per-model tokens are missing and its 2.1 s covers recheck and cleanup together.
- **Script:** `../measure-12/measure.mjs` gained hidden foods, each flagged food and AI Change, the boot's steps from the server log, job times, tokens per model, the cases from tickets 24 to 30 with their checks, and `report`. `compare` now prints counts only. The run files, the server log and the page are in `~/Documents/norish-ticket-31/` (`report.html`), outside the repo.
- **Time:** the cleanup took 15 s and the server was ready in 26.6 s, against 2.1 s and 6.5 s in ticket 12, but a test run had the machine at load average ~7.7. An AI-off clone booted right after cleaned up in 2.6 s, so this is the load, not a ticket (that clone was dropped). The AI pass asked 134 foods (70 in ticket 12, since the marks are cleared) and took 112 s over 6 jobs; 3 icon jobs drew 9 icons in 85 s.
- **Requests and tokens:** 163 review requests, 231,791 tokens (gpt-6-luna 148 / 224,544, Jev 15 / 7,247), 0 failed; icons 9 requests of gpt-image-1-mini. Jev's 15 against 7 in ticket 12 are ticket 26's second questions for slip-only finds.

**Ingredients**

|               | before | 0.26 AI on (ticket 12) | after |
| ------------- | -----: | ---------------------: | ----: |
| all           |   6426 |                   6351 |  6331 |
| own           |    707 |                    621 |   601 |
| seeded        |   5719 |                   5730 |  5730 |
| flagged       |      4 |                      9 |     7 |
| keptDistinct  |      0 |                    114 |     0 |
| withParent    |   6002 |                   5941 |  5945 |
| ownWithParent |    586 |                    515 |   519 |

**Flagged, by reason**

|                | before | 0.26 AI on (ticket 12) | after |
| -------------- | -----: | ---------------------: | ----: |
| ai-unsure      |      4 |                      9 |     6 |
| ai-unavailable |      – |                      – |     1 |

**Spellings**

|     | before | 0.26 AI on (ticket 12) | after |
| --- | -----: | ---------------------: | ----: |
| all |  71608 |                  71438 | 71409 |
| own |   1904 |                   1382 |  1353 |

**Joined names still a food of their own**

|           | before | 0.26 AI on (ticket 12) | after |
| --------- | -----: | ---------------------: | ----: |
| own foods |     92 |                     32 |    26 |

**Recipe lines**

|                         | before | 0.26 AI on (ticket 12) | after |
| ----------------------- | -----: | ---------------------: | ----: |
| colon line, with a food |     11 |                     11 |     1 |
| heading                 |    164 |                    164 |   164 |
| no food                 |     19 |                     21 |    45 |
| one food                |   6033 |                   5828 |  5805 |
| several, alternatives   |      – |                     63 |    68 |
| several, together       |      – |                    140 |   144 |

**Rows that point at no food**

|                    | before | 0.26 AI on (ticket 12) | after |
| ------------------ | -----: | ---------------------: | ----: |
| groceries          |      0 |                      1 |     0 |
| recurringGroceries |      0 |                      0 |     0 |
| pantryIngredients  |      0 |                      0 |     0 |

**Rows**

|                    | before | 0.26 AI on (ticket 12) | after |
| ------------------ | -----: | ---------------------: | ----: |
| lines              |   6227 |                   6227 |  6227 |
| groceries          |     71 |                     72 |    72 |
| recurringGroceries |      8 |                     11 |    11 |
| pantryIngredients  |      7 |                      7 |     7 |

**Hidden (ticket 25)**

|                     | before | 0.26 AI on (ticket 12) | after |
| ------------------- | -----: | ---------------------: | ----: |
| grocery foods       |      9 |                      6 |     7 |
| foods nothing names |     77 |                     73 |    77 |

**AI Changes**

|                  | before | 0.26 AI on (ticket 12) | after |
| ---------------- | -----: | ---------------------: | ----: |
| merge, sure      |      – |                     20 |    25 |
| merge, unsure    |      – |                      5 |     2 |
| not-a-food, sure |      – |                      3 |    13 |
| parent, sure     |      – |                     19 |    35 |
| parent, unsure   |      – |                      – |     1 |

**The first start**

|                                         | before | 0.26 AI on (ticket 12) | after |
| --------------------------------------- | -----: | ---------------------: | ----: |
| ready, ms                               |      – |                   6500 | 26559 |
| Catalogue cleaned up, ms                |      – |                   2100 | 14964 |
| Catalogue cleaned up: seeded            |      – |                      3 |     3 |
| Catalogue cleaned up: cleaned           |      – |                     86 |    77 |
| Catalogue cleaned up: removed           |      – |                    421 |   430 |
| Catalogue cleaned up: split             |      – |                     59 |    59 |
| Catalogue cleaned up: renamed           |      – |                      6 |     5 |
| Catalogue cleaned up: asked             |      – |                     70 |   134 |
| Seed corrections made, ms               |      – |                      – |   302 |
| Undecided mints looked at again, ms     |      – |                      – |    62 |
| Seed corrections made: moved            |      – |                      – |     5 |
| Seed corrections made: refiled          |      – |                      – |     1 |
| Undecided mints looked at again: merged |      – |                      – |     0 |
| Undecided mints looked at again: filed  |      – |                      – |     1 |

**AI use, ingredient-review queue**

|                                          | before | 0.26 AI on (ticket 12) |        after |
| ---------------------------------------- | -----: | ---------------------: | -----------: |
| jobs                                     |      – |                      4 |            6 |
| requests                                 |      – |                     87 |          163 |
| failed                                   |      – |                      0 |            0 |
| tokens                                   |      – |                  98768 |       231791 |
| job time, s                              |      – |                     53 |          112 |
| first start to last end, s               |      – |                      – |          112 |
| openai · gpt-6-luna, requests / tokens   |      – |                 80 / – | 148 / 224544 |
| typesafe · jev-1.13.0, requests / tokens |      – |                  7 / – |    15 / 7247 |

**AI use, ingredient-icons queue**

|                                              | before | 0.26 AI on (ticket 12) | after |
| -------------------------------------------- | -----: | ---------------------: | ----: |
| jobs                                         |      – |                      2 |     3 |
| requests                                     |      – |                      4 |     9 |
| failed                                       |      – |                      0 |     0 |
| tokens                                       |      – |                      0 |     0 |
| job time, s                                  |      – |                     41 |    85 |
| first start to last end, s                   |      – |                      – |    85 |
| openai · gpt-image-1-mini, requests / tokens |      – |                  4 / – | 9 / 0 |

**The cases** (after; the page has each case's lines and foods in all three columns):

- Holding: "salt cinnamon" and "koud water melk" split into their foods, not deleted (24); "rode pesto" and "sriracha sauce" not merged into red port and oyster sauce, "tortilla's" on tortilla (26); "chocolate whey" keeps whey and "Italian herbs" herb (27); "ground cumin" under cumin, "mango blokjes" under mango (28); "light cooking cream or non-fat Greek yogurt" split into alternatives (29). The new food light cooking cream was then merged into light cream by AI, sure, which reads right.
- Not holding: "chinese 5 spice" lost spice (27, ticket 35); "Nora reserve eten" is hidden and kept, but the recheck filed it under meat (25/28, ticket 33); 1 colon line still names a food (30, ticket 34); "Denta tix" keeps tea (27): it is hidden now (nothing names it), so AI never asks about it. That follows ticket 25 and the 90-day sweep removes it, so not a ticket.
- Ticket 12's cases: "zout en peper", "boter of olie" and "water of kokosmelk" are split; "deegroller" (a tool) and "melted" are deleted, now that their Keep distinct marks are cleared, and their lines keep their text with no food. The 26 more lines with no food are those 16 deleted junk and tool lines and 10 colon lines.

**Results that look wrong, each a ticket:** 32 (AI's parent "jam" found yam by its Croatian spelling), 33 (a singular last word found meat's Turkish "et"), 34 (a colon line on a clean spelling keeps its food), 35 (AI drops 6 parents that are categories: spice, mixed spices, sauce, herb), 36 (3 readings timed out at the 10 s budget, 1 food left flagged, and the ledger misses them).
