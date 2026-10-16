# 02: Installed-app documents are seeded

**What to build:** A page the installed app loads through its service worker carries the same seed as a browser tab.

- `QuerySeed` seeds only when the request says `Sec-Fetch-Dest: document` (`components/query-seed.tsx:29`). The service worker answers navigations network-first with navigation preload (`app/sw.ts:117,137`). Find out what the server sees for a preload request and for the worker's own fetch, in Chromium and Safari.
- If either arrives without it, the seed must still run for a navigation, for example on the `Service-Worker-Navigation-Preload` header or a header the worker adds, without seeding the RSC and prefetch requests it skips today.

**Blocked by:** 01 (the service-worker-allowed baseline).

**Status:** ready-for-agent

- [ ] What each path sends, recorded here.
- [ ] If a path wasn't seeded: the fix, and an E2E with `serviceWorkers: "allow"` that a reload after install carries a recipe in the server's markup.
- [ ] 01's harness, service worker allowed: before and after.

## Comments
