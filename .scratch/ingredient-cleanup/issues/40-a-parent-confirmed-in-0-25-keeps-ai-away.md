# 40: A parent confirmed in 0.25 keeps AI away from its food

**What to build:** Found by the audit of ticket 31's final run (2026-10-22, `m31c_post_on`, HEAD 0dab43bd8). With AI on, 40 own foods (74 lines) are left as near-duplicates of another food: "chilli flakes", "chili vlokjes" and "chili vlokken" beside "chili flakes"; "kippendijen" beside chicken thigh; "eiwitpoeder" beside protein powder; "applesauce" beside "apple sauce".

**The cause.** AI never read 37 of the 40. Each has `parent_chosen`, and `askableByAI` (`packages/db/src/repositories/ingredient-catalogue.ts`) skips a food a person parented. In 0.25 the flag was set by `setParent`, and confirming a parent suggestion went through `setParent` too (`confirmSuggestion`, Confirm all included). So the flag mostly records a click on AI's or the words' suggestion, not a parent a person picked.

- On the 0.25 copy, 498 of 707 own foods have it. After the first start, 428 of the 511 listed own foods still do, so the pass asked about 134 foods in every run of ticket 31.
- The same flag keeps AI from all 29 joined foods left (ticket 44), and from 14 of the audit's 18 wrong parents, all from 0.25 (sugar snaps under sugar, salam blaadjes under salami, king prawns under apples, red pepper flakes under red bell pepper).
- The other 3 were asked, and AI's names came close without matching: "baby potatoes with skin" for "krieltjes in schil" beside baby potatoes, "baking spray" / "cooking spray" beside "cooking oil spray", "taco" beside taco shells. The lookup takes an exact name or a slip of the fingers only (ticket 15 removed the word-start search). This ticket does not change that.
- Copies asked in the same pass are not a problem: the copy asked second finds the first by AI's English name ("chili flakes"), whichever order they come in.

**Fix (default, the non-destructive reading):** a chosen parent protects only the parent. `askableByAI` drops `parentChosen = false`, so AI may merge, split, rename or delete such a food (each with Undo). `parentByAI` (`packages/shared-server/src/ingredients/ai-changes.ts`) leaves a chosen parent as it is. The docs sentence "AI leaves alone an ingredient you marked distinct, renamed or gave a parent" (release notes 0.26, `groceries/ingredients.md`) changes to say that a parent you gave stays.

- Cost: about 430 more foods at the first start on the copy, roughly three times ticket 31's 163 requests and 232k tokens.

**For Mike:** should 0.25's `parent_chosen` stop counting at all? The first start would clear it once, so AI may also re-parent those foods. That fixes the 14 old wrong parents, but it also overrides parents a person really picked, each with Undo.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] A food whose parent a person chose is asked about, and may be merged into the food it duplicates.
- [ ] AI never changes a parent a person chose.
- [ ] On a rerun of ticket 31's measurement, "chilli flakes", "chili vlokjes" and "chili vlokken" name one food with "chili flakes".
