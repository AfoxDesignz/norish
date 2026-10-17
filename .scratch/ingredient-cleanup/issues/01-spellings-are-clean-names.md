# 01: Spellings are clean names

**What to build:** A translation is always a clean name. Before the resolver reads a text, it strips stray punctuation, unmatched brackets, doubled brackets, a leading "+ / - :", prices like "($0.02)" and notes like "(Note 1)". "gyoza vellen ((ontdooid))" and "12 gyoza vellen" both point at the translation "gyoza vellen". A new food gets only its clean spelling: plain, else bare. A join with a known food adds the same. Neither ever adds the text as written. Today's bracket stripping leaves the ")" of "((ontdooid))"; that bug is fixed in the shared spelling keys, so the clients match the same way. A colon line with no amount names no food when read ("Voor de salade:"). A typed grocery that names no food (")") mints nothing and points at no food. The seed strips stray marks ("3wu)" becomes "3wu", "|चौलाई}}" becomes "चौलाई") and keeps balanced brackets, which tell foods apart ("paprika (vrucht)" stays bell pepper). A translation a person types in the Ingredient panel is stored as typed. A recipe save keeps the foods of every line whose text, amount and unit didn't change, and resolves only changed or new lines. Words only: no AI is involved.

See `CONTEXT.md` (Ingredient Alias, Junk Line) and ADR-0037's second 2026-10-17 amendment.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Resolving "gyoza vellen ((ontdooid))", "gyoza vellen (ontdooid)" and "12 gyoza vellen" gives one alias, whose text is "gyoza vellen"; no alias with brackets or a number is created.
- [ ] Spelling keys strip nested and doubled brackets whole, and no key ends in a stray ")".
- [ ] Prices, "(Note n)" notes and a leading "+", "/", "-" or ":" are stripped before reading, and the line's own text is unchanged.
- [ ] A colon line with no amount stores no food; a colon line with an amount is read as before.
- [ ] A grocery typed as ")" or "—" is saved with no food and mints no Ingredient.
- [ ] Seed entries lose stray marks and keep balanced brackets; "paprika (vrucht)" still resolves to bell pepper exactly.
- [ ] A translation added in the panel keeps its text as typed.
- [ ] Saving a recipe after editing one line resolves only that line; the other lines keep their foods without asking AI (asserted with AI mocked at the runtime).
- [ ] Resolver and spelling-key tests cover the cases above against a real database; `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm i18n:check` and `pnpm build` pass.
