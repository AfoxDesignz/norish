# 09: Settings tabs are seeded

**What to build:** A full load of a settings tab draws its fields filled, not empty.

- Seed by `?tab` in `app/(app)/settings/page.tsx`:
  - **User (the default tab):** `user.get` and `user.getAllergies`, `recipes.shareListMine`, `siteAuthTokens.list`, `config.localeConfig`, `config.timersEnabled`. `user.get` is watched above the page, so this needs 06's fill-during-render boundary.
  - **CalDAV:** `getConfig`, `getSyncStatus`, `getSummary`. Never `getPassword` (a secret in a document the service worker caches) and never `checkConnection` (it calls the reader's CalDAV server).
  - **Household:** comes with 03.
- `user.get` carries API-key metadata, which would then sit in a document the service worker caches (the reason 03 leaves it out). Seed it only if the user tab draws those keys anyway; otherwise leave it to the browser and seed the rest.

**Blocked by:** 01, 03, 06.

**Status:** ready-for-agent

- [ ] `first-paint.e2e.ts`: the user tab's server markup has the reader's name in its field.
- [ ] 01's harness, `/settings?tab=user`: before and after.

## Comments
