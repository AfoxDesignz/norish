# 01: Measure before and after

**What to build:** A committed page-load harness, and the baseline every other ticket in this folder is judged against. Skeletons and page loads measured with a script that wasn't kept, so its calendar and Today's meals change went unmeasured.

- The harness lives in the repo (for example `apps/web/scripts/measure-page-loads.ts`, not under `__tests__/`, which lint ignores) and runs against a production build on `:3400` (`pnpm build`, then `pnpm --filter @norish/web run start` with `PORT=3400 AUTH_URL=http://localhost:3400 AUTH_RATE_LIMIT_ENABLED=false UPLOADS_DIR=…`).
- Method, as `.scratch/skeletons-and-page-loads/issues/06-*.md`: Playwright Chromium as a Pixel 7, CPU ×4, 1.6 Mbps down / 750 kbps up, one warm-up, then the median (and spread) of 15 cold loads, signed in as the dev owner.
- Per page it records first paint, the first frame its content is on screen (a `requestAnimationFrame` loop on a selector per page), and the document's gzip size. Run twice: service worker blocked, and allowed (for 02).
- Pages and their content marks: `/` (a library card, Today's meals, the navbar avatar), `/calendar` (a day with a plan), a recipe (title, first ingredient, rating), a share link, a cookbook (header, first member), `/groceries` (a price, an aisle heading), `/groceries/pantry` ("From your recipes"), `/settings?tab=user` (the name field filled).
- Also an in-app tap from the Library to an uncached recipe, so a ticket can show it got no slower.

**Blocked by:** none.

**Status:** ready-for-agent

- [ ] The harness committed, with a one-paragraph README of how to run it.
- [ ] The baseline for every page above, recorded here, both service-worker modes.
- [ ] The calendar and Today's meals change of 2026-10-16 (`0afe47d90`, `02c61dbf6`): its before, from a build of `08dd753cb` in a separate worktree (ask the maintainer first), and its after.

## Comments
