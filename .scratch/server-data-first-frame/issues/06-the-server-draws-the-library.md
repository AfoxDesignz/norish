# 06: The server draws the Library

**What to build:** A full load of `/` shows the reader's recipe cards in the first paint. Adopted only on a measured win, as `.scratch/skeletons-and-page-loads/issues/07-*.md` was.

- **Seeded queries fill during render.** The shell's `RecipesContextProvider` already watches `library.list` above the page, and `HydrationBoundary` fills an existing query only in an effect, so the server would still draw the skeleton. `QuerySeedBoundary` (`components/query-seed-boundary.tsx`) fills a seeded query whose cache entry has no data yet during render. 09 relies on this too.
- **Seed `library.list`** (infinite, the page's own input, under 05's filters) beside the calendar read in `app/(app)/page.tsx`.
- **Rows on the server:** the grid's window virtualiser (`components/dashboard/library-grid.tsx`) gets an `initialRect` from Device Kind, so the server and the hydrating render draw the same first rows; the browser corrects it once it has measured.
- **Bytes:** dashboard rows are an estimated 1–1.5 KB each, so a 100-row first page is 20–35 KB gzip, against 07's 7.5 KB, which cost about 100 ms of first paint. Drop fields no card reads (`notes`, if nothing else reads it) and measure; a smaller seeded page would part from the Warm Set's floor (ADR-0009).

**Blocked by:** 01, 05.

**Status:** ready-for-agent

- [ ] 01's harness, `/`: content time, first paint and document size, before and after; the in-app tap no slower. **Decision:** adopt only if content time improves by more than the spread and first paint by no more than the gain is worth; otherwise revert and record the numbers here.
- [ ] If adopted: `first-paint.e2e.ts` asserts a recipe card in the server's markup, and a reader who scrolls before hydration sees no blank space past the server's rows (or the ticket records why it doesn't matter).

## Comments
