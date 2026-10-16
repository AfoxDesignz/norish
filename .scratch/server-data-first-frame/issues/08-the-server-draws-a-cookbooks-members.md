# 08: The server draws a cookbook's members

**What to build:** A full load of a cookbook shows its members, not only its header, in the first paint.

- Seed `cookbooks.recipes` (infinite) with `cookbookRecipesInput(id, filters)` under 05's filters in `app/(app)/cookbooks/[id]/layout.tsx`, beside `cookbooks.get`. No shell provider watches that key.
- The member grid gets 06's `initialRect` from Device Kind.

**Blocked by:** 01, 05, 06, 07.

**Status:** ready-for-agent

- [ ] `first-paint.e2e.ts`: a cookbook's server markup carries a member's card.
- [ ] 01's harness, a cookbook: before and after.

## Comments
