# 11: Names in the viewer's language

**What to build:** Surfaces that show an Ingredient rather than a line (the Ingredients page, the Pantry and ingredient search) show the alias in the viewer's locale, falling back to the canonical name. A Dutch user sees "ui" where an English user sees "onion". Recipe lines and grocery lines always keep their as-written text. Search finds an Ingredient by any of its aliases in any language.

**Blocked by:** 07, 10

**Status:** ready-for-agent

- [ ] Choosing a display name is tested for: locale present, locale missing (canonical fallback), and several aliases in one locale (chosen deterministically).
- [ ] The Pantry and the Ingredients page render the locale name. Recipe and grocery lines are unchanged.
- [ ] Search matches aliases in every language.
