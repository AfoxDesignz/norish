# 46: AI checks the spellings a person, a merge or an import added (once, at the first start)

**What to build:** Found by the audit of ticket 31's final run (2026-10-22, `m31c_post_on`). Seeded chicken breast holds the spellings "boneless" (5 lines) and "lbs boneless" (1 line). Neither was seeded. Both were created on 2026-10-09 in 0.25: a line like "boneless, skinless chicken breasts" was cut at the comma (rung 2's bare reading is "boneless"), and the fragment was merged into chicken breast.

- AI never reads a seeded food, so nothing ever looks at the spellings added to one.
- No word rule tells "boneless" (wrong) from "kipfilet" (right). Ticket 43 is closed for that reason.

**Counts on the copy (`m31c_post_on`, after the first start).**

- **Seeded foods:** 510 non-seeded spellings (`ingredient_aliases.seeded = false`) on 268 foods. 159 foods have 1, 53 have 2, and 56 have 3 to 9. In a sample of 30, "boneless" was the only clear wrong one, and "bloemkoolrijst" on cauliflower the only doubtful one. The rest are translations or line texts that name the food ("gerookt paprikapoeder", "olie om te bakken").
- **Own foods:** 251 non-seeded spellings that are not the food's own name, on 189 foods. A sample of 30 had no wrong spelling ("hamburgerbroodjes" on burger buns, "sterke espresso", "snoep nora"). Own foods are left out.

**The 6 lines on the two spellings.** Their texts are "boneless, skinless chicken breast(s)" with a note, cut or price ("…, cut into strips", "(about 1 lb.) (($5.79))"), and once "lbs boneless, skinless chicken breast (…)". They name chicken breast only through the comma cut. If the spelling is removed and they are resolved again today, rung 2 reads "boneless" again, finds nothing, and mints "boneless" for each owner. AI's pass then deletes it as not a food, and the lines name nothing. That is why this ticket relies on ticket 47's rule: a piece on the junk pile is dropped. "boneless" is dropped and the line is read as "skinless chicken breasts". Rungs 1–2 do not know that text on the copy, because only "boneless skinless chicken breasts" is a spelling. So it mints (its words may file it under chicken breast), and AI's pass is asked about it in step 8 (one more request; expected: merged into chicken breast). The lines never end up with no food.

**Fix (Mike, 2026-10-22: "we need this indeed, but only for manually added non seeded"):** a first-start step, once, just before the AI pass (step 8). Each seeded food with non-seeded spellings gets one request. It lists only those spellings, never seed spellings, and asks: which of these name this food, which are not a food, and which name another food (with its name)?

- **Names this food:** kept.
- **Not a food:** the fold goes on the junk pile (ticket 47). The spelling is removed (`deleteCatalogueAlias`), and its rows are resolved again (`resolveAgain`, line text unchanged). With the pile, the remaining pieces name the food, or the line names no food (Junk Line).
- **Names another food:** AI's name is looked up through `findNamed`, like any AI name: an exact spelling is taken, and slips alone go to the second question. The spelling moves to the food found (`moveCatalogueAlias`), and its rows follow. If nothing is found, the spelling is removed as below.
- **Not this food, no other named:** the spelling is removed and its rows are resolved again, minting where nothing knows the text. AI's pass reads the mint in step 8.
- **AI Changes.** Each removal or move is an AI Change with Undo, and the Undo is remembered. The kinds today (`AI_CHANGE_KINDS`: merge, parent, plain-name, not-a-food) do not cover this, so add one kind, `spelling`. Its Undo puts the spelling back on its food and points back the rows that named it, the way `not-a-food` keeps a deleted food's rows (`readDeletedFood`). For a "not a food" removal, the Undo also takes the fold off the pile.
- **Prompt.** A new administrator-editable prompt, named through `ai/runtime` (ADR-0016), lives beside the resolution prompts.
- **Version.** `CLEANUP_VERSION` goes 4 → 5. The step runs only when coming from below 5, with its own constant, the way `PARENTS_UNMARKED_IN` stays at 4. With AI off at the first start, nothing is asked and nothing changes. There is no retry later.
- **Cost.** 268 requests on the copy. At ticket 31's average (224,544 tokens / 148 reading requests, about 1,520 each), that is about 410k tokens. That is roughly 1.8 times ticket 31's whole first-start pass (163 requests, 232k), plus a few second questions (about 480 tokens each) and the step-8 requests for the mints it leaves. At ticket 31's pace (164 requests in 84 s), that is about 2.5 minutes.
- Docs: a release-notes line. The 0.26 upgrade note on the first-start cleanup says AI checks the spellings people and imports added to seeded foods, each change has Undo, and it costs this much. `CONTEXT.md`'s AI Change entry gains "removed or moved a spelling that does not name its food".

**Blocked by:** 47 (the junk pile and its piece rule)

**Status:** ready-for-agent

- [ ] After the first start with AI on, "boneless" and "lbs boneless" are no spellings of chicken breast, and the 6 lines still name chicken breast (directly, or through a mint AI merges in).
- [ ] Seed spellings are never listed or removed, and own foods are not asked.
- [ ] Undo on Changed by AI puts the spelling and its lines back, and AI does not remove it again.
