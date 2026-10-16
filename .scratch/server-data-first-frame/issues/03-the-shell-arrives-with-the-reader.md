# 03: The shell arrives with the reader

**What to build:** Every full load of the signed-in app carries who the reader is, so the navbar avatar, the edit actions, hearts and allergy flags are in the first frame.

- Seed in `app/(app)/layout.tsx`, handed to the App Shell as a prop (the offline bootstrap mounts the same shell with none): the reader's identity for `useUser` (`packages/shared-react` `use-user.ts`), `permissions.get`, `favorites.list`, `user.getAllergies`, `recipes.getPending` and `households.get`.
- The boundary sits inside `AuthProviders`, above the providers that read these, so they are new to the cache and fill during render. `QuerySeed` returns its dehydrated state for this, instead of only wrapping children.
- **Not `user.get`:** it carries API-key metadata, and the service worker caches documents.
- The identity must be the same in the server render and the hydrating one; the account-switch path stays as it is.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] `first-paint.e2e.ts`: the server's markup has the navbar avatar and a recipe's actions menu for an editor.
- [ ] 01's harness: before and after for `/` and a recipe (avatar, actions).

## Comments
