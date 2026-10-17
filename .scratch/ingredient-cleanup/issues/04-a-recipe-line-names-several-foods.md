# 04: A recipe line names several foods

**What to build:** A recipe line whose text joins foods points at each of them, either as foods needed **together** or as **alternatives**. The line keeps its text.

**The split rule** (words only):
- A name known whole by rungs 1–2 is never split ("mac and cheese", "half and half").
- Otherwise it splits at a joining word when every part matches by rungs 1–2. The joining words are a new kind of Ingredient Word: "and", "en", "und", "&" (together); "or", "oder", "ou", "of", "en/of", "and/or" (alternatives); plus each shipped language's words.
- "of" is accepted only when the parts are not all English spellings, read from the alias locale as a hint: "juice of a lemon" stays one, "boter of olie" and "water of kokosmelk" split.

**What reads it:**
- **Pantry:** an alternatives line is covered when any of its foods is kept. A together line is checked food by food.
- **Add to groceries:** the panel shows one row per food it will add. Each food of a together line comes with the line's full amount. An alternatives line adds only its first food.
- **Nutrition:** an alternatives line counts its first food; a together line counts each food at the full amount.
- **Icon:** the line shows its first food's icon.
- **Uses:** the "where used" panel and in-use counts list the line under every food it names.

See `CONTEXT.md` (Ingredient Alias, Ingredient Words, Pantry Ingredient, Ingredient Icon) and ADR-0037's third 2026-10-17 amendment.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] "zout en peper", "boter of olie", "water of kokosmelk" and "parmezaanse kaas en/of pijnboompitten" (with both parts known) resolve to two foods with the right join.
- [ ] "mac and cheese" (known whole), "juice of a lemon" (all English), "handful of arugula" (one part not a food) and "Arla Skyr Peach & Passionfruit" (a part not known) stay one food.
- [ ] The joining words ship in every language's Ingredient Words, and an administrator's edited set is honoured.
- [ ] Pantry: "boter of olie" is in the pantry when only olie is kept. With "zout en peper" and only zout kept, peper goes on the list and zout shows as stocked.
- [ ] Add to groceries: "2 el boter en suiker" adds 2 el boter and 2 el suiker; "boter of olie" adds boter.
- [ ] Nutrition counts "100 g boter of olie" as 100 g boter, and "100 g ham en kaas" as 100 g of each.
- [ ] The line shows the first food's icon; both foods' "where used" panels list the line.
- [ ] Browser: a recipe with "zout en peper" added to the groceries puts "zout" and "peper" on the list as two groceries (catalogue spec, `ai` project).
- [ ] All `CONTRIBUTING.md` gates pass.
