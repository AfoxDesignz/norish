# 42: A parent is found only by a spelling in a language Norish reads

**What to build:** Found by the audit of ticket 31's final run (2026-10-22, `m31c_post_on`). Some own foods are filed under a seeded food through a spelling that happens to look like their words: burger buns and bao buns under pear, salam blaadjes and salam leaves under salami, sugar snaps under sugar, king prawns under apples.

**The paths.**

- **Burger buns and bao buns (this release, with AI).** AI read the parent as "bun". `findNamed` → `findOtherFoodsNamed` (`resolver.ts`) found the fold "bun" at rung 1, and that fold is pear's Volapük (`vo`) spelling "bün". An exact spelling is taken without a second question, so both foods were filed under pear as sure parents. The 0.25 copy already had them under pear, through the words.
- **Salam (from 0.25).** 0.25's words read the first word "salam" as salami's Czech (`cs`) spelling "salám". The parent was confirmed, so it has `parent_chosen` and AI never looked again (ticket 40). This release's words would not do it: `parentFromWords` reads a first word only before forms, and "blaadjes" and "leaves" are none.
- **Sugar snaps and king prawns (from 0.25, English).** 0.25 read "sugar" as the first word; king prawns came from a mint "raw king prawns", and "raw" is an English spelling of Open Food Facts' junk food "apples". No language rule reaches these. Only ticket 40's question does.

**Which languages.** `CATALOGUE_LANGUAGES` (`packages/shared/src/lib/ingredient-names.ts`) already lists the 17 catalogue languages that Norish's locales (`packages/i18n/src/messages`) read. On the copy, 21 own foods have a seeded parent their words find only through a spelling outside that list:

- in `vo`, `cs`, `id`, `an` and `ro`: wrong or chance matches;
- in `af`, `fy`, `li` and `hr`: words that are Dutch as well (kaas `af`, mosterd `af`, brood `af`, saus `fy`, mayonaise `li`, paprika `hr`).

The second group exists because spellings are unique by fold and the first language in an entry claims a shared one. Open Food Facts lists `af: Kaas` before `nl: kaas` under `en:cheese` (`applyIngredientSeed`, first claim first). The same rule gave "jam" to yam's `hr` spelling (ticket 32).

**Fix (one rule):** AI's names (`findOtherFoodsNamed`) and a mint's words (`parentFromWords` → `findSeededFoodSpellingsByFolds`) find a seeded food only by a spelling in `CATALOGUE_LANGUAGES`. Own spellings always count. Import rungs 1–2 do not change, so Dutch "paprika" still finds bell pepper (ticket 32).

- **Prerequisite:** where several of an entry's languages share a fold, the seed files it under a language Norish reads (kaas under `nl`, not `af`). In `seedEntriesOf`, list the entry's Norish-language names first. On an instance seeded before, re-stamp the locale of seeded spellings once in `correctSeedOnce` and raise `SEED_CORRECTIONS_VERSION`.
- **Known cost:** Open Food Facts spells bell pepper as bare "paprika" only in `hr`; `nl` has "paprika (vrucht)". So a mint "oranje paprika" gets no parent from its words, and AI's pass files it. "paprika poeder" no longer lands under bell pepper either, which is right.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] AI's parent "bun" does not file burger buns under pear.
- [ ] A new food "salam blaadjes" is not filed under salami.
- [ ] A new food "belegen kaas" is still filed under cheese, also on an instance seeded before this release.
