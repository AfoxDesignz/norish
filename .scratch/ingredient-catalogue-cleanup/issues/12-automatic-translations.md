# 12: Automatic translations

**What to build:** AI adds a food's name in every language the server has enabled (`ENABLED_LOCALES`) where the food has no spelling in that language yet. It runs automatically for new ingredients, and as a Fix catalogue part over the foods recipes name. See the spec, item 9.

**Blocked by:** 01, 07

**Status:** ready-for-agent

- [ ] **Admin → AI config → _Automatic for new ingredients_** gains **Add translations**, off by default, following the AI switch. It runs in the `new-ingredients` job after settling (01), only if the food still exists.
- [ ] **The Fix catalogue dialog** gains the part, with a count and token estimate, over catalogue foods a recipe names (07) that miss at least one enabled language.
- [ ] **Asking.** One request per food for all its missing languages, through the runtime with a Prompt of its own (ADR-0016). Update the Prompt count in `CONTEXT.md`. Find what an unset `ENABLED_LOCALES` means and use that set.
- [ ] **Writing.**
  - Each answer becomes a spelling with its locale (not seeded, no owner).
  - A translation whose fold another food holds is skipped, so it never moves another food's spelling.
  - The panel marks translations AI added; a person removes or moves one as today.
- [ ] **Tests:**
  - only missing languages are asked;
  - a taken fold is skipped;
  - the toggle and the part;
  - the scope count.

## Comments
