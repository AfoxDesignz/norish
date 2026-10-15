# 08: Server data on the other pages

**What to build:** If 07 is adopted, the other pages whose data the URL alone names get the same treatment: share, cookbook, groceries, pantry, today's meals and the calendar (its range from Device Kind).

- Same rules as 07: the query cache stays the only source the page reads, cache first in the app, no extra fetch on mount.
- The library grid stays in the browser, because its filters live only there.
- The share page sits outside the signed-in app and has no Offline Cache owner; its server data is the share token's recipe.

See `.scratch/skeletons-and-page-loads/spec.md`, The server-data pilot.

**Blocked by:** 07. Done only if 07 is adopted; otherwise closed as wontfix.

**Status:** done for share, cookbook, groceries and pantry; calendar and today's meals left out (see below)

- [x] Each page, one commit, with its server markup asserted in `first-paint.e2e.ts`.
- [x] Cold-load time to content per page, before and after, recorded here.
- [ ] The whole E2E suite passes against a fresh `pnpm build`. Run on 2026-10-15 against a fresh build with 08: 180 passed. Of the three reds, two were this work's (the by-recipe skeleton scenario, now checked on an in-app visit since a full load draws the list; the offline switch-back step) and pass after fixes, the whole offline project and `first-paint.e2e.ts` green, the new scenarios 15/15 on `--repeat-each=3`. The third is `calendar-planning.e2e.ts:73`, see 06.

## Comments

- 2026-10-15, **share, cookbook, groceries and pantry seeded.**
  - **How.** 07's layout became `components/query-seed.tsx` (`QuerySeed`): on a document load (`Sec-Fetch-Dest: document`) it runs the given reads through the tRPC caller and hands them over with `HydrationBoundary`; anything else gets an empty boundary. Each route wraps itself in it:
    - share (`share/[token]/layout.tsx`): `recipes.getShared` and `recipes.sharePublicConfig`, which work signed out
    - cookbook (`cookbooks/[id]/layout.tsx`): `cookbooks.get` only, the header. Its recipes stay in the browser like the library grid, since their filters live in `localStorage`.
    - groceries and pantry (`groceries/layout.tsx`, one layout for both views): `groceries.list`, `stores.list` and `pantry.list`, what either view's first frame draws
  - **No extra fetch on mount, narrowed.** 07 first made `recipes.get` refetch on mount only when stale. The E2E run caught what that broke: a copy restored from the Offline Cache younger than five minutes no longer refreshed on open, though it may predate a change made while the app was closed (`image-generation.e2e.ts` saw the old photo). Now only the server's copy counts: `QuerySeedBoundary` notes, in memory for this page load, the data each seeded query arrived with, and the global `refetchOnMount` is `false` while a query still holds exactly that data, `"always"` otherwise. A restored copy, or one changed since, refetches as before. Folded into 07's commit.
  - **Method.** 06's profile, signed in as the dev owner (the share page signed out), median of 15 cold loads. Content is the first frame in which the page's own data is visible: the recipe's title and first ingredient on the share page, the cookbook's title, a grocery's name, a Pantry row. A `requestAnimationFrame` loop checks from the first frame.

    | Content on screen (median, ms) | Before                  | After             |
    | ------------------------------ | ----------------------- | ----------------- |
    | share page                     | 5,072 (5,053–5,133)     | 860 (844–880)     |
    | cookbook                       | 6,414 (6,364–6,446)     | 828 (812–852)     |
    | `/groceries`                   | 10,030 (9,986–10,111)   | 796 (784–804)     |
    | `/groceries/pantry`            | 10,219 (10,181–10,268)  | 748 (740–756)     |

    In each case the content now arrives with first paint. Checked in a browser on phone and desktop: no hydration errors, and no seeded read is fetched again on load.
  - **Left out: the calendar and today's meals.** Both take their range, and today's meals its date label, from the browser's clock and time zone (`getInitialDateRange` builds local weeks from `new Date()`, and the label formats in the runtime's zone). The server knows neither the reader's time zone nor, near midnight, their date, so its range would key a different query and its label could differ from the browser's, a hydration mismatch. Seeding them needs the reader's time zone on the server, for example a cookie the browser writes; that is a decision for the maintainer. The spec's "range from Device Kind" doesn't match the code either: the calendar uses the same five-week range on every kind.
  - **Seen on the way:** the Warm Set warms `cookbooks.recipes` as `{ cookbookId, limit: 100 }`, while the cookbook page reads it with the library filters (`limit: 50`, sort, and so on), so the warmed entry never serves that page.
