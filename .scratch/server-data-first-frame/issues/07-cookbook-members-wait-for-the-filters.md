# 07: Cookbook members wait for the filters

**What to build:** A cookbook page asks for its members once, under the reader's stored filters.

- `app/(app)/cookbooks/[id]/cookbook-members.tsx` reads the filters without waiting for `isHydrated`, as `components/dashboard/library-view.tsx` does. So it fetches and shows the default list, then fetches again under the stored filters: a wrong list flashes and two requests go out.
- Wait as the Library does (the skeleton until the filters are read). With 05 the filters are there from the first render.

**Blocked by:** none.

**Status:** ready-for-agent

- [ ] E2E: with stored filters, opening a cookbook makes one `cookbooks.recipes` request and never shows a member the filters leave out.

## Comments
