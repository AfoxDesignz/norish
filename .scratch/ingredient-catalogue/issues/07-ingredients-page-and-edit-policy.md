# 07: Ingredients page and edit policy

**What to build:** A user-facing **Ingredients** page under settings. It lists Ingredients with search, each showing its aliases and flag, with a flagged filter. Its actions are add alias, rename and mark distinct, and an action the viewer may not take is hidden. A new instance-wide ingredient permission policy, set by the administrator beside the recipe permission policy, has one level, `edit`: everyone, household or owner, defaulting to household. Ingredients are always visible. Rules:
- Adding an alias is open to everyone.
- Renaming follows `edit` on the Ingredient.
- Removing an alias follows `edit` on the alias.
- Ownerless (seeded) rows are editable only by administrators, and administrators bypass the policy.

Renaming or marking a flagged Ingredient distinct clears its flag.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The policy setting exists with its default, is editable in admin settings, and is documented.
- [ ] tRPC caller tests cover the everyone/household/owner matrix, admin-only ownerless rows and the administrator bypass.
- [ ] The page lists, searches and filters by flag. Add alias, rename and mark distinct work, and each clears the flag where the spec says so.
- [ ] Copy is in i18n, and `pnpm i18n:check` passes.
