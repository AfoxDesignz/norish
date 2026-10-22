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

## Rerun after tickets 32, 33 and 35 (2026-10-22)

- **How:** HEAD 095149606, the same way: fresh clone `m31b_post_on` of `norish_prod_pristine` (129 Keep distinct marks cleared, clone only, left in place), booted once from a detached worktree with AI on (production config) and its own Redis, measured once the queues were idle a minute. The ticket 12 and ticket 31 columns re-read `m12_post_on` and `m31_post_on` (counts unchanged), their AI use and first start copied from their runs. Before is identical to ticket 31's.
- **Load:** average 6.4 to 7.2 during the first start (another process kept the Docker VM busy); ready in 5.1 s, cleanup 2.6 s.
- **Script:** the case texts and lookups moved to a private file outside the repo (`MEASURE_CASES`, default `~/Documents/norish-ticket-31/cases.json`); the script keeps the checks. Page: `~/Documents/norish-ticket-31/report-b.html` (before, ticket 12, ticket 31, now).
- **Cases:** every case from 24 to 30 that held still holds. "chinese 5 spice" keeps spice; Cajun seasoning, harissa kruiden and bagel everything kruiden are under mixed spices, ranch seasoning keeps mixed condiments, adobo sauce keeps sauce (35). bone-in short ribs, nut butter and 3 more still lose their wrong parent; Klop-Fix keeps fish because its reading timed out (36). "Hero Bosvruchtenjam" is under jam (32). "Nora reserve eten" is hidden, with no parent and untouched (33). 1 colon line still names a food (34, open). "Denta tix" keeps tea, hidden, as before.
- **Timeouts (36, open):** 2 readings ran over the 10 s budget, 0 foods left flagged; the log has 147 gpt-6-luna completions, the ledger 145.
- **New:** 37 (a category found a placeholder own food: 1 food filed under it).

**Ingredients**

|               | before | ticket 31 |  now |
| ------------- | -----: | --------: | ---: |
| all           |   6426 |      6331 | 6324 |
| own           |    707 |       601 |  594 |
| seeded        |   5719 |      5730 | 5730 |
| flagged       |      4 |         7 |    6 |
| keptDistinct  |      0 |         0 |    0 |
| withParent    |   6002 |      5945 | 5954 |
| ownWithParent |    586 |       519 |  528 |

**Flagged, by reason**

|                | before | ticket 31 | now |
| -------------- | -----: | --------: | --: |
| ai-unsure      |      4 |         6 |   6 |
| ai-unavailable |      – |         1 |   – |

**Spellings**

|     | before | ticket 31 |   now |
| --- | -----: | --------: | ----: |
| all |  71608 |     71409 | 71409 |
| own |   1904 |      1353 |  1353 |

**Joined names still a food of their own**

|           | before | ticket 31 | now |
| --------- | -----: | --------: | --: |
| own foods |     92 |        26 |  24 |

**Recipe lines**

|                         | before | ticket 31 |  now |
| ----------------------- | -----: | --------: | ---: |
| colon line, with a food |     11 |         1 |    1 |
| heading                 |    164 |       164 |  164 |
| no food                 |     19 |        45 |   44 |
| one food                |   6033 |      5805 | 5804 |
| several, alternatives   |      – |        68 |   71 |
| several, together       |      – |       144 |  143 |

**Rows that point at no food**

|                    | before | ticket 31 | now |
| ------------------ | -----: | --------: | --: |
| groceries          |      0 |         0 |   0 |
| recurringGroceries |      0 |         0 |   0 |
| pantryIngredients  |      0 |         0 |   0 |

**Rows**

|                    | before | ticket 31 |  now |
| ------------------ | -----: | --------: | ---: |
| lines              |   6227 |      6227 | 6227 |
| groceries          |     71 |        72 |   72 |
| recurringGroceries |      8 |        11 |   11 |
| pantryIngredients  |      7 |         7 |    7 |

**Hidden (ticket 25)**

|                     | before | ticket 31 | now |
| ------------------- | -----: | --------: | --: |
| grocery foods       |      9 |         7 |   7 |
| foods nothing names |     77 |        77 |  77 |

**AI Changes**

|                  | before | ticket 31 | now |
| ---------------- | -----: | --------: | --: |
| merge, sure      |      – |        25 |  29 |
| merge, unsure    |      – |         2 |   3 |
| not-a-food, sure |      – |        13 |  13 |
| parent, sure     |      – |        35 |  33 |
| parent, unsure   |      – |         1 |   2 |

**The first start**

|                                         | before | ticket 31 |  now |
| --------------------------------------- | -----: | --------: | ---: |
| ready, ms                               |      – |     26559 | 5076 |
| Seed corrections made, ms               |      – |       302 |   50 |
| Undecided mints looked at again, ms     |      – |        62 |   35 |
| Catalogue cleaned up, ms                |      – |     14964 | 2627 |
| Seed corrections made: moved            |      – |         5 |    6 |
| Seed corrections made: refiled          |      – |         1 |    1 |
| Undecided mints looked at again: merged |      – |         0 |    0 |
| Undecided mints looked at again: filed  |      – |         1 |    0 |
| Catalogue cleaned up: seeded            |      – |         3 |    3 |
| Catalogue cleaned up: cleaned           |      – |        77 |   77 |
| Catalogue cleaned up: removed           |      – |       430 |  430 |
| Catalogue cleaned up: split             |      – |        59 |   59 |
| Catalogue cleaned up: renamed           |      – |         5 |    5 |
| Catalogue cleaned up: asked             |      – |       134 |  134 |

**AI use, ingredient-review queue**

|                                          | before |    ticket 31 |          now |
| ---------------------------------------- | -----: | -----------: | -----------: |
| jobs                                     |      – |            6 |            6 |
| requests                                 |      – |          163 |          162 |
| failed                                   |      – |            0 |            0 |
| tokens                                   |      – |       231791 |       240453 |
| job time, s                              |      – |          112 |           88 |
| first start to last end, s               |      – |          112 |           88 |
| openai · gpt-6-luna, requests / tokens   |      – | 148 / 224544 | 145 / 231928 |
| typesafe · jev-1.13.0, requests / tokens |      – |    15 / 7247 |            – |
| typesafe · jev-1.14.0, requests / tokens |      – |            – |    17 / 8525 |

**AI use, ingredient-icons queue**

|                                              | before | ticket 31 |   now |
| -------------------------------------------- | -----: | --------: | ----: |
| jobs                                         |      – |         3 |     2 |
| requests                                     |      – |         9 |     4 |
| failed                                       |      – |         0 |     0 |
| tokens                                       |      – |         0 |     0 |
| job time, s                                  |      – |        85 |    39 |
| first start to last end, s                   |      – |        85 |    39 |
| openai · gpt-image-1-mini, requests / tokens |      – |     9 / 0 | 4 / 0 |

## Final run after tickets 34, 36 and 37 (2026-10-22)

- **How:** HEAD 0dab43bd8, the same way: fresh clone `m31c_post_on` of `norish_prod_pristine` (129 Keep distinct marks cleared, clone only, left in place), booted once from a detached worktree with AI on (production config) and its own Redis, measured once the queues were idle a minute. Load average 4.0 at the start. Run files, `report-c.html` and a one-page `summary.html` are in `~/Documents/norish-ticket-31/`.
- **First start:** ready in 5.1 s, cleanup 2.6 s; the cleanup cleared 1 colon line (34) and unflagged 1 hidden food.
- **AI pass:** 164 requests (gpt-6-luna 150 / 239,919 tokens, Jev 14 / 6,845), 246,764 tokens, 84 s over 6 jobs, 0 failed, 0 timeouts; the log's 150 completions and 14 Decisions match the ledger (36). Icons: 6 images in 55 s.
- **Counts:** flagged 7 (all ai-unsure; 0 hidden), colon lines with a food 0, no food 45, joined own foods 24. AI Changes: merge 31 sure / 2 unsure, not-a-food 13 sure, parent 32 sure / 2 unsure (of the parent changes, 5 remove a parent).
- **Cases:** every case from 24 to 37 holds but two. One of ticket 26's two cases is merged again into the unrelated food, unsure: the second question picked the slip (38). "Denta tix" keeps tea, hidden, as before (not a ticket). Ticket 37: the one parent change onto an own food is AI's parent, not a category.
- **New:** 38 (the second question picks an unrelated slip), 39 (an other name AI gives merges, sure, into a different seeded product: 1 food).

## Run after tickets 32-48 (2026-10-22)

- **How:** HEAD fa3fb4295, the same way: fresh clone `m48_post_on` of `norish_prod_pristine` (129 Keep distinct marks cleared, clone only, left in place), booted once from a detached worktree with AI on (production config) and its own Redis, measured once both queues were idle a minute. Load average 3.4 at the start. Run files, `report-48.html` and `summary-final.html` are in `~/Documents/norish-ticket-31/`. The script gained generic checks (`linesName`, `linesNot`, `noSpelling`, `sameFood`) for the cases of tickets 38-48, and lists spelling changes.
- **First start:** ready in 5.9 s, cleanup 3.5 s (split 57, unmarked 462 confirmed parents), junk pile seeded 211, 252 seeded foods queued for the spelling check.
- **AI pass:** 922 requests (gpt-6-luna 860 / 1,161,370 tokens, Jev 62 / 34,424), 1,195,794 tokens, 344 s over 19 jobs, 0 failed, 0 timeouts; the log's 860 completions match the ledger. First pass 559 foods, 636 requests; spelling check 252 requests, 164,363 tokens, 51 s. Icons: 16 images in 152 s.
- **Counts:** own foods 478 (last run 595), flagged 22 (all ai-unsure; 9 are targets of unsure merges), colon lines with a food 0, no food 50 (5 more, all right), joined own foods 10. AI Changes: merge 130 sure / 9 unsure, parent 59 / 4, parent removed 17 / 0, not-a-food 15, plain name 2, spelling removed 8, spelling moved 1; 35 splits by AI.
- **Cases:** every case from 24 to 48 holds but four: one ticket 40 case is merged, sure, into the wrong seeded food (49); one split still drops the word its parts share (41's rule does not reach it); ticket 45's case is not split, AI unsure, flagged (its wrong food is gone); ticket 27's hidden case keeps its parent, as before. Ticket 44: 28 of the 29 joined foods are split or merged as one; 1 is read as one food.
- **Crap left** (listed own foods, judged as the audit did): 27 of 389, against 99 of 511 last run. Still joined 2 (29), near-duplicates 8 (40), wrong parent 6 (18), missing parent 7 (4), splits on a wrong food 3 (7), seeded foods with a wrong spelling 7 (12), note spellings 162 (167), brands merged into their general food 9 (0).
- **New:** 49 (a food's words merge it, sure, into another seeded food: 1 food, 7 lines), 50 (brands merged into the general food: 9), 51 (the spelling check undoes a same-start merge: 1, and moves a comma fragment: 1), 52 (seed spellings that name another food: 2), 53 (a right parent dropped: 2, a category on a wrong food: 1).

## Run after tickets 50 and 54 (2026-10-22)

- **How:** HEAD c93158c4f, the same way: fresh clone `m54_post_on` of `norish_prod_pristine` (129 Keep distinct marks cleared, clone only, left in place), booted once from a detached worktree with AI on (production config) and its own Redis, measured once both queues were idle a minute. Load average 3.7 at the start. A first attempt was dropped and redone from a fresh clone: the Mac went into maintenance sleep 8 s into the AI pass (285 s), which timed out requests; the server now runs under `caffeinate -ims`. Run files, `report-54.html` and `summary-54.html` are in `~/Documents/norish-ticket-31/`. The script gained a `notFlagged` check for ticket 54's cases; the private cases file gained ticket 50's and 54's.
- **First start:** ready in 4.8 s, cleanup 3.5 s, every cleanup count as last run.
- **AI pass:** 894 requests (gpt-6-luna 848 / 1,161,343 tokens, Jev 46 / 25,174), 1,186,517 tokens, 402 s over 13 jobs, 0 failed, 0 timeouts; the log's 848 completions match the ledger. First pass 618 requests in 286 s; spelling check 252 requests, 164,393 tokens, 57 s. Icons: 15 images in 143 s.
- **Counts:** own foods 477 (last run 478), flagged 20 (22): 4 targets of unsure merges, 5 unsure parents, 11 left as they were. Colon lines with a food 0, no food 49, joined own foods 9. AI Changes: merge 131 sure / 4 unsure, parent 58 / 5, parent removed 14 / 0, not-a-food 15, spelling removed 5, spelling moved 1; 35 splits by AI.
- **Cases:** ticket 54's hold (the three slip merges are sure, nothing flagged). Ticket 50's: 6 of 8 hold; the 2 that do not are its open root cause 2 (the general food held the specific spelling in 0.25). Ticket 49's red pepper flakes holds. Three checks that held last run do not now, each an unsure reading left as it was and flagged: 1 of ticket 35's wrong parents, 2 of ticket 44's joined foods. As before: 1 split drops the shared word (41), ticket 45's case unsplit, ticket 27's hidden case.
- **Crap left** (judged as last run; last run's judgement kept for own foods that did not change): 36 of 388, against 27 of 389. Still joined 3 (2), near-duplicates 12 (8), wrong parent 8 (6), brand with no parent 1 (2), missing parent 10 (7), specific food merged into its general food 6 (8), splits on a wrong food 2 (3), seeded foods with a wrong spelling 7 (7), note spellings 163 (162). Most of the rise is AI reading a food differently from last run.
- **New:** 55 (a language model's sure pick overrides a Decision that doubted it: 3 foods, 5 lines). 4 more dropped parents fit 53, 1 more general-food merge fits 50's root cause 2.

## Run after ticket 56 (2026-10-22)

- **How:** HEAD 44297d433, the same way: fresh clone `m56_post_on` of `norish_prod_pristine` (129 Keep distinct marks cleared, clone only, left in place), booted once from a detached worktree under `caffeinate -ims` with AI on (production config) and its own Redis, measured once both queues were idle a minute. Load average 2.1 at the start. A first attempt was dropped and redone from a fresh clone: Next.js stopped the dev server 2 s into the AI pass to show an upgrade notice to an agent (a retry continues past it). Run files, `report-56.html` and `summary-56.html` are in `~/Documents/norish-ticket-31/`; the private cases file gained ticket 55's and 56's cases (italian sausage now checks "under sausage").
- **First start:** ready in 4.7 s, cleanup 3.5 s, every cleanup count as last run.
- **AI pass:** 886 requests (gpt-6-luna 857 / 873,893 tokens, Jev 29 / 15,919), 889,812 tokens (last run 1,186,517), 529 s over 18 jobs, 1 failed: one reading timed out, was asked once more and answered; the log's 857 sent = 856 completed + 1 failed = the ledger. By prompt, from the log: reading 579 / 698,706 (last run 573 / 977,068), match 6 / 3,528 (10 / 13,632), spelling check 252 / 162,357, plain name 19 / 9,302. First pass 336 s, spelling check 73 s. Icons: 20 images in 189 s.
- **Counts:** own foods 532 (last run 477), listed own foods 443 (388), flagged 21 (20): 3 targets of unsure merges, 5 unsure parents, 13 left as they were. Colon lines with a food 0, no food 51, joined own foods 10. AI Changes: merge 81 sure / 3 unsure (131 / 4), parent 77 / 4, parent removed 20 / 1, not-a-food 17, plain name 3, spelling removed 5; 35 splits by AI.
- **Cases:** all of ticket 56's hold (its 3 specific foods under their parent, the specific-broccoli case and its copy, the chili case, the brioche case sure). Three checks that held last run do not now: 1 of ticket 24's splits (AI unsure, kept whole, flagged), ticket 28's ground spice case (its food lost its specific parent for the category spice), ticket 50's brand merges (1 right, 1 onto the wrong food, 4 kept under the general food). As before: ticket 35's one unsure wrong parent, 1 split drops the shared word (41), ticket 45's case unsplit, ticket 27's hidden case, ticket 50's 0.25 spelling, 51/52/53 not built.
- **Crap left** (judged as last run): 83 of 443, against 36 of 388. Still joined 3 (3), near-duplicates 54 (12), wrong parent 10 (8), brand with no parent 2 (1), missing parent 13 (10), specific food merged into its general food 0 (6), splits on a wrong food 4 (2), seeded foods with a wrong spelling 8 (7), note spellings 163 (163). Also 4 brands kept under their general food and 14 parents loosened to spice, not counted. The rise is near-duplicates: the new reading gives other names for 29% of foods (71% last run), and 4 more by ticket 56's rule.
- **Run to run:** of the 232 foods AI changed in m54, 134 got the same change now, 5 the same with the other sureness, 39 a different change, 54 none; m48 to m54 was 164 of 242, 6, 35, 37. Of 573 names read in both runs: same kind 571, same sureness 562, same parent and category 460 (487 m48 to m54).
- **New:** 57 (AI's English name is the parent it gives: 4 foods, 8 lines, and 4 brands), 58 (the lean reading prompt gives fewer other names and broader parents: 39 near-duplicates, 14 parents loosened to spice), 59 (a split part read again alone and deleted: 1 food, 1 line). 2 more seed-spelling results fit 52, 1 merge undone and redone fits 51, 8 dropped parents fit 53.

## Run after tickets 57, 58 and 60 (2026-10-22)

- **How:** HEAD 67eb2082a, the same way: fresh clone `m60_post_on` of `norish_prod_pristine` (129 Keep distinct marks cleared, clone only, left in place), booted once from a detached worktree under `caffeinate -ims` with AI on (production config) and its own Redis, measured once both queues were idle a minute. Load average 1.6 at the start. The server was started once before on a throwaway AI-off clone (dropped) so Next.js's upgrade notice stopped that start, not the run. Run files, `report-60.html` and `summary-60.html` are in `~/Documents/norish-ticket-31/`; the private cases file gained ticket 57's and 58's cases, and the m54/m56 columns re-read their clones for them.
- **First start:** ready in 4.8 s, cleanup 3.6 s, every cleanup count as the last two runs.
- **AI pass:** 891 requests (gpt-6-luna 859 / 850,369 tokens, Jev 32 / 17,969), 868,338 tokens (last run 889,812), 359 s over 19 jobs (529), 0 failed, 0 timeouts; the log's 859 completions match the ledger. By prompt, from the log: reading 580 / 673,092 (last run 579 / 698,706), match 10 / 5,642, spelling check 252 / 163,464 in 54 s, plain name 17 / 8,171. First pass 229 s. Icons: 18 images in 162 s.
- **Counts:** own foods 506 (last run 532), listed own foods 417 (443), flagged 16 (21): 1 target of an unsure merge, 3 unsure parents, 3 slips AI's second question doubted, 9 left as they were. Colon lines with a food 0, no food 51, joined own foods 10. AI Changes: merge 110 sure / 1 unsure (81 / 3), parent 60 / 3, parent removed 16 / 0, not-a-food 17, plain name 1, spelling removed 7; 35 splits by AI.
- **Other names:** given for 46% of foods read (m54 71%, m56 29%). Category spice 13 times (24, m54 7). Parents moved to spice against m54: 8 (14), no powder among them.
- **Cases:** ticket 57's hold (its 4 foods and kippendijen merge, 3 of 4 brands merge into their general food); ticket 58's powders keep their specific parent; ticket 56's pumpkin puree, italian sausage and Tenderstem broccoli hold; ticket 24's and 28's that failed last run hold again. One check that held last run does not now: ticket 42's salam case is a second own food. Not holding as before: 1 of ticket 35's wrong parents back (AI gave it) plus its unsure one, 2 of ticket 44's joined foods read unsure and kept whole (2 others split now), ticket 45's case, ticket 41's shared-word split, ticket 50's 0.25 spelling and 1 brand kept under its general food, 51/52/53/59 not built, ticket 27's hidden case. Ticket 60's plain name made 1 rename, case only (62).
- **Crap left** (judged as last run): 64 of 417, against 83 of 443 last run and 36 of 388 in m54. Still joined 3 (3), near-duplicates 37 (54), wrong parent 5 (10), brand with no parent 3 (2), missing parent 14 (13), tool 1, note 1 (0), specific food merged into its general food 0 (0), splits on a wrong food 5 (4), seeded foods with a wrong spelling 10 (8), note spellings 162 (163). Also 1 brand kept under its general food (4) and 8 parents loosened to spice (14), not counted.
- **Run to run:** of the 232 foods AI changed in m54, 154 got the same change now, 0 the same with the other sureness, 33 a different change, 45 none (m54 to m56: 134, 5, 39, 54). Of 572 names read in both m54 and now: same kind 568, same sureness 562, same parent and category 471 (459 m54 to m56, counted the same way).
- **New:** 61 (an unsure "not a food" deletes a real food: 1 food, 1 line), 62 (a plain name differing only in case renames: 1 food), 63 (an other name that is the parent's spelling keeps the same food under it: 1 food, 3 lines), 64 (other names still missing for 54% of foods: 6 new near-duplicates, 11 lines, and 18 of ticket 58's 39 still). 1 merge undone and redone twice fits 51, 2 seed-spelling results fit 52, 1 dropped parent fits 53, 1 deleted split part fits 59, 1 merge fits 39.
