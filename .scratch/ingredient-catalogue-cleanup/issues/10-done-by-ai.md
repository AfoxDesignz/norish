# 10: Done by AI

**What to build:** what AI applies on its own ends up unflagged, so it leaves no trace a person can look over. The only record today is the job's steps, and job retention deletes those. Keep a durable list of every change AI applied, with an undo per change, until someone marks it seen. Mike, 2026-10-16: "perhaps we can still get a list of what AI did even though its no longer flagged and applied so users can still review".

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] **Storage.** A table of its own, one row per applied change. Each row records:
  - the kind;
  - the food's name as it was;
  - the foods involved;
  - what an undo needs (for a merge, the alias ids moved);
  - when, and which job.

  It must not cascade away with a merged food, which is why `ingredient_suggestions` does not fit.

- [ ] **Writing.** Every applied change writes a row:
  - settling (01, 03, 05);
  - the automatic Plain Name rename (`giveNewIngredientItsPlainName`);
  - Fix catalogue rounds (01, 09).

  A round's report keeps only what the round could not settle.

- [ ] **The Suggestions panel** gets a second section, **Done by AI**, newest first, in the same virtual list. Each row has **Undo** and **OK**, and the section has **All good**. The page header shows its count beside the flagged count. A person sees only rows about foods they may edit.

  | Row                       | Undo                                                                                    |
  | ------------------------- | --------------------------------------------------------------------------------------- |
  | merged into X             | moves the moved spellings back out into a food of its own                               |
  | filed under X             | clears the parent (a person's choice)                                                   |
  | names no food             | the lines get a food again, minted from their text                                      |
  | split into X + Y          | the spelling becomes one food again                                                     |
  | renamed to its Plain Name | the old name is back; both spellings stay, since the old one is what the lines point at |
  | a food of its own         | none; the row opens Merge into…                                                         |

  Every undo is a person's decision, so the food comes out clean (no flag).

- [ ] **How long a row lives:** until OK, All good or Undo. A row also drops out once its food is gone or a person has changed it since. There is no time limit.
- [ ] **Copy** in all locales.
- [ ] **Tests:**
  - each change kind writes a row;
  - each undo restores what it says;
  - OK and All good clear rows;
  - rows filter by edit policy;
  - a row whose food a person changed drops out.

## Comments
