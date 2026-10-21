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

**Status:** ready-for-agent

- [ ] The report page is written outside the repository, with the three columns and every statistic above.
- [ ] The compare table's counts are in this ticket too; names and lines only in the page.
- [ ] Each case from tickets 24 to 30 shows as holding or not, including "salt cinnamon", "koud water melk" and "… reserve eten".
- [ ] Flagged foods are counted before and after, by reason, with their names in the page.
- [ ] Requests and tokens are counted.
