# 12: Browser spec, docs and release notes

**What to build:** Cover the feature end to end in the browser and document it. One spec in the `ai` Playwright project, seeding its own small catalogue rather than fetching:
- A Dutch "ui" in the Pantry leaves an English recipe's "onion" off the list.
- A flagged Ingredient shows on the Ingredients page.
- Merging it into the Ingredient that holds an Aisle Link files its grocery in that Aisle.

The spec follows the pantry and grocery-aisles specs, including their shared-database traps. Docs per `docs/agents/feature-docs.md`: `apps/docs` pages for the Ingredients page, the ingredient edit policy and the Data sources page, with screenshots, plus the release-notes entry for the Target Version.

**Blocked by:** 08, 09, 10, 11

**Status:** ready-for-agent

- [ ] The new E2E spec passes alongside the existing `ai` project specs.
- [ ] The docs pages and screenshots are added, and the Upgrade notes cover the migration and the env var.
- [ ] The release notes are updated.
- [ ] All gates pass: `pnpm lint`, `pnpm test:run`, `pnpm i18n:check` and `pnpm build`.
