# 05: Library filters in a cookie

**What to build:** The server knows the reader's Library filters on a full load, so it can ask for the same list the browser will.

- The web storage adapter (`apps/web/hooks/recipes/recipe-filters-storage-adapter.ts`) writes the filters to a cookie as well as localStorage. `app/(app)/layout.tsx` reads it, checks it with `normalizePersistedRecipeFilters` (`packages/shared-react/src/contexts/recipes/filter-contract.ts`), and hands it to the App Shell; `RecipesFiltersProvider` starts from it already hydrated. An optional prop, so the mobile app is untouched, and localStorage stays the fallback without a cookie.
- **Not on the profile:** a Device Preference is how Norish is shown, per Device Kind; filters belong to a browser, and every chip tap would be a profile write.
- Keep the cookie small: only what differs from the defaults.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Unit: the stored filters round-trip through the cookie, and a malformed one falls back to the defaults.
- [ ] The Library's first render on a full load uses the cookie's filters, with no hydration mismatch.

## Comments
