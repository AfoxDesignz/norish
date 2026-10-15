# 07: Server-data pilot on the recipe page

**What to build:** On a full load of a recipe page, the first paint is the recipe itself. Adopted only on a measured win.

- The server reads the recipe through the tRPC caller (as `recipes/edit/[id]` does) and hands it to the browser's query cache with `HydrationBoundary`. The page still reads only from the query cache (ADR-0001).
- **Cache first in the app:** an in-app navigation renders from the browser cache when it holds the recipe, and the skeleton otherwise. The server's data streams and never holds a navigation up.
- The server's copy counts as fresh: no extra fetch on mount. Recovery's startup refetch still reconciles it.
- An account switch clears the service worker's page and RSC caches too, since documents now carry recipe data (ADR-0005).

See `.scratch/skeletons-and-page-loads/spec.md`, The server-data pilot.

**Blocked by:** 01 and 06 (the baseline is taken after both), 03 (the recipe skeleton it falls back to).

**Status:** ready-for-agent

- [ ] Baseline: the median time until the recipe's title and ingredients are on screen, using 06's method. Also an in-app tap on an uncached recipe. Recorded here.
- [ ] Variant: the same two numbers, recorded here.
- [ ] **Decision.** Adopt only if the cold-load median improves by more than the baseline's run-to-run spread and the in-app tap is no slower. Otherwise revert, record the numbers, and close 08.
- [ ] If adopted:
  - [ ] `first-paint.e2e.ts`: a recipe page's server markup (JavaScript disabled) carries the title; its header comment is updated.
  - [ ] A new E2E in the offline project: a cached recipe page is gone after another account signs in on the same browser.
  - [ ] The whole E2E suite passes against a fresh `pnpm build`.
  - [ ] A release-notes line under Fixes and Improvements with the measured gain.
