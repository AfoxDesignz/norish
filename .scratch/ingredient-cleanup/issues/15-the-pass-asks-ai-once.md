# 15: The pass asks AI once

**What to build:** The background pass (07) asks AI one question per food instead of two (read, then compare). AI says what the name is, and the code looks that up in the catalogue (Mike, 2026-10-20: "reversing the question perhaps so letting ai decide and we do a bit of fuzzy matching").

- **The one question** sends no catalogue. It asks what the name is:
  - its plain English name, the more general food it is a kind of, and two or three other names a shop sells it under; or
  - several foods: each part named, in the language written, and whether they go together or are alternatives; or
  - not a food.
  
  AI also says whether it is sure.
- **The code decides**, with the matching an import uses (translations, plurals, preparation, slips):
  - **One food matches** the English name or another name: the food is merged into it. "Unox Knaks" is read as "frankfurter", and the catalogue has frankfurter.
  - **Nothing matches, but the general food does:** it stays a food of its own, filed under that one. "rode uien" is read as "red onion" with general food "onion"; with no red onion in the catalogue, it goes under onion.
  - **Neither:** a food of its own. The Plain Name step follows as today.
  - **Several:** each named part is resolved as an import resolves it, and the food is split into them when AI is sure (08). The answer lists the parts, and so does the job monitor's step: "Dijon or yellow mustard" into "Dijon mustard" and "yellow mustard". Unsure, it stays one food, flagged.
  - **Not a food:** deleted, as in 13.
- **An unsure answer** is applied and flagged, as today. Undo memory is checked as today.
- **Only when the lookup is ambiguous**, when the names match more than one food, is the second question asked over just those foods. That is the Decision where it is on, else the language model.
- **The prompt:** the administrator-editable `ingredient-resolution` prompt is rewritten for the one question. The release notes tell an administrator who edited it to compare theirs with the new default.

**Blocked by:** 14, which leaves the pass as the only place rung 3 runs.

**Status:** ready-for-agent

- [ ] "Unox Knaks" with frankfurter in the catalogue: one AI request, merged into frankfurter.
- [ ] "rode uien" with onion but no red onion: one request, a food of its own under onion.
- [ ] "Dijon or yellow mustard", sure: one request, split into the two mustards it names. Unsure: one food, flagged.
- [ ] "melted": one request, deleted.
- [ ] A name whose reading matches two foods: two requests, and the second answer decides.
- [ ] The job monitor's step shows what AI read the name as, and for several foods the parts.
- [ ] Pass tests mock AI at `generateStructured` and `decide`, against a real database.
- [ ] All `CONTRIBUTING.md` gates pass.
