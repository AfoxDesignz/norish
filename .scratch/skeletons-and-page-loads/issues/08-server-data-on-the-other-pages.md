# 08: Server data on the other pages

**What to build:** If 07 is adopted, the other pages whose data the URL alone names get the same treatment: share, cookbook, groceries, pantry, today's meals and the calendar (its range from Device Kind).

- Same rules as 07: the query cache stays the only source the page reads, cache first in the app, no extra fetch on mount.
- The library grid stays in the browser, because its filters live only there.
- The share page sits outside the signed-in app and has no Offline Cache owner; its server data is the share token's recipe.

See `.scratch/skeletons-and-page-loads/spec.md`, The server-data pilot.

**Blocked by:** 07. Done only if 07 is adopted; otherwise closed as wontfix.

**Status:** ready-for-agent

- [ ] Each page, one commit, with its server markup asserted in `first-paint.e2e.ts`.
- [ ] Cold-load time to content per page, before and after, recorded here.
- [ ] The whole E2E suite passes against a fresh `pnpm build`.
