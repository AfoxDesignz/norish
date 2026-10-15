# 06: Less competes with the first stylesheet

**What to build:** The first frame paints sooner on a phone, because less loads alongside the stylesheet it waits for.

- Measure first, with the Cache Components spike's method (`.scratch/architecture-after-upgrades/issues/08-cache-components-spike.md`): the production build, Playwright as a Pixel 7 with CPU ×4, 1.6 Mbps down / 750 kbps up, service worker blocked, one warm-up load and the median of 15 cold loads of `/`, a recipe page and `/groceries`.
- Find what JS and CSS load before first paint. Defer what the first frame doesn't need and let the stylesheet go first. What gets cut follows from the measurement.

See `.scratch/skeletons-and-page-loads/spec.md`, First paint.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] Before: first paint per page, and what loads before it, recorded here.
- [ ] The cuts, one commit each.
- [ ] After: the same numbers, recorded here. If a cut doesn't move first paint, it is reverted.
- [ ] The whole E2E suite passes against a fresh `pnpm build`.
- [ ] If first paint moves, a release-notes line under Fixes and Improvements with the measured gain.
