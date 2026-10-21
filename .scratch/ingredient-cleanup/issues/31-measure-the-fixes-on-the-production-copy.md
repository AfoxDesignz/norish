# 31: Measure the fixes on the production copy

**What to build:** Ticket 12's run of this release with AI on, again on a fresh clone of `norish_prod_pristine`, once tickets 24 to 30 are done. Before the first start the clone clears every Keep distinct mark, so AI asks those 114 foods too (Mike, 2026-10-21: only the measurement, never a person's database). Read with `measure-12/measure.mjs` and compared against ticket 12's table. The same rules as ticket 12: nothing writes to the template, recipe text stays out of the repo, and every result that looks wrong becomes a ticket of its own.

**Blocked by:** 24, 25, 26, 27, 28, 29, 30

**Status:** ready-for-agent

- [ ] The compare table and named cases are in this ticket, beside ticket 12's 0.26 AI-on column.
- [ ] Each case from tickets 24 to 30 is checked here, including "salt cinnamon", "koud water melk" and "… reserve eten".
- [ ] Requests and tokens are counted.
