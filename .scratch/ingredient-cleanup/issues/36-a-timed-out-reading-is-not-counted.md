# 36: A timed-out reading flags its food and is not counted

**What to build:** Found by ticket 31. With AI on, 3 of 151 reading requests ran over the 10 s budget each request has since ticket 26's review fix (`REQUEST_BUDGET_MS`), all in the first 35 s of the pass while many ran at once (the machine was busy, load average about 7). Two of the foods are no longer flagged after the follow-up passes; one is left flagged `ai-unavailable` until the nightly sweep. Ticket 12's run, under the old 30 s budget over the whole question, had none.

The requests still finished and used tokens (the log has 151 completions), but the job monitor's ledger counted 148 OpenAI requests, 3 short, as many as timed out: a request that times out is in neither the requests nor the tokens.

- On the production copy: 3 timeouts, 1 food left flagged, 3 requests and their tokens missing from the Models row.
- To decide: a longer budget for the reading request, and recording a timed-out request in the ledger as failed with what it used.

**Blocked by:** None

**Status:** needs-triage

- [ ] A busy pass leaves no food flagged `ai-unavailable` for a slow answer.
- [ ] The job monitor counts every request sent, timed out ones too.
