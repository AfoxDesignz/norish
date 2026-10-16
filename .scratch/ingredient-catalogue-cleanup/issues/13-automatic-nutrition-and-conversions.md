# 13: Automatic nutrition and conversions

**What to build:** AI fills in what Norish has no data on. It runs automatically for new ingredients, and as Fix catalogue parts over the foods recipes name. See ADR-0039 (amended 2026-10-16) and the Ingredient Nutrition entry.

- **Fill in nutrition:** AI writes per-100 g numbers, only for a food with no data at all: no dataset food of its own and nothing to borrow from a parent.
- **Fill in conversions:** a piece weight or density, only where a recipe line counts the food in pieces or measures it by volume and reaches no grams. It comes from the food's own dataset food where USDA has a portion, else from AI's estimate.

**Blocked by:** 01, 07

**Status:** ready-for-agent

- [ ] **Admin → AI config → _Automatic for new ingredients_** gains **Fill in nutrition** and **Fill in conversions**, off by default, run after settling (01). Fix catalogue gains both as parts, with counts and token estimates, over catalogue foods a recipe names (07) that lack them.
- [ ] **Storage.** An estimate is the food's own, for every household, marked as AI's.
  - Consider storing it as a dataset food of its own (an `ai` dataset row the food's nutrition codes point at), so every reader works unchanged. A dataset food the Ingredient gains later then takes precedence by being listed first.
  - A household's correction outranks it as today.
- [ ] **Totals.** A worked-out total that leans on an AI number or conversion says it is estimated, counted like a borrowed value. The per-line estimate for lines left out stays for whatever still reaches no grams.
- [ ] **The Ingredient panel's nutrition section** shows AI's numbers and conversions as AI's, correctable as today.
- [ ] **Asking.** Through the runtime with a Prompt of its own (ADR-0016), giving the food's name, its spellings and its parent. Update the Prompt count in `CONTEXT.md`.
- [ ] **Tests:**
  - "no data" detection (own, borrowed, a bad lender);
  - a conversion only where a line needs it;
  - USDA portion before AI;
  - a later dataset food winning;
  - a correction winning;
  - the "estimated" label;
  - the toggles and parts.

## Comments
