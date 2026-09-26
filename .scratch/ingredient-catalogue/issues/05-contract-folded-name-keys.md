# 05: Contract: remove the folded-name keys

**What to build:** Once the pantry, groceries and links all read through aliases, remove the old identity path. No code decides identity from `normalizedName` any more, and the old columns, indexes and fold helpers that only served identity are dropped. Recipe lines drop their direct ingredient pointer in favour of the alias. The app behaves exactly as it did after 02 and 04.

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] No identity reads or writes remain on folded-name keys or on the recipe line's direct ingredient pointer.
- [ ] A migration drops the obsolete columns and indexes.
- [ ] Any fold helper left serves display or search only, and is named accordingly.
- [ ] `pnpm lint`, `pnpm test:run`, `pnpm build` and the grocery and pantry E2E specs pass.
