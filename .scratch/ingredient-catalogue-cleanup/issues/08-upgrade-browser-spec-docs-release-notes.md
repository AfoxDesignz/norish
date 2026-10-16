# 08: The upgrade, browser spec, docs and release notes

**What to build:** what an existing instance gets on upgrade, the browser coverage, and the feature docs.

**Blocked by:** 01, 03, 05, 06, 07, 09, 10, 11, 12, 13

**Status:** ready-for-agent

- [ ] **Upgrade, with no AI.**
  - Bump `RUNG_VERSION` so the recheck pass runs the word split (05) over every untouched minted food, flagged or not ("sale e pepe" and the like split), as well as its rung 1–2 merges.
  - The cleanup (07) runs once.
- [ ] **Upgrade, with AI on.** Queue settling (01) for untouched flagged foods whose AI step never ran: `ai-unavailable`, `unknown-food`, `ai-key-rejected`. Every other flag waits for Fix catalogue.
- [ ] **Browser spec**, `ai` project (remember `INGREDIENT_CATALOGUE_URL=""`):
  - an import with a mint the fake model is sure about settles into the known food and the flag is gone;
  - a "names no food" line keeps its text;
  - a compound "and" line puts two groceries on the list and an "or" line leaves one unticked;
  - a rename onto a taken name merges with the line rewritten;
  - the page hides a grocery-only food.
- [ ] **Docs** (`apps/docs`), per `docs/agents/feature-docs.md`:
  - the Ingredients page: what settles itself, Show all, the rename choice, split suggestions;
  - Ingredient Words: the "or" list;
  - screenshots per memory `norish-docs-screenshots`.
- [ ] **Release notes** for 0.26.0: one bullet per user-visible change, plus the upgrade's behaviour. Mention that the one AI pass on upgrade covers only foods AI never saw.
- [ ] **The before/after numbers from 02** in the PR body.

## Comments
