# 24: AI answers in one checked shape

**What to build:** Found by ticket 12. AI's reading of a name is a flat object whose fields may all be empty whatever the verdict, and "several" is defined only for names joined by "and" or "or". So "salt cinnamon" and "koud water melk", two foods side by side, had nowhere to go and were answered "not a food" while AI was unsure, and deleted. Mike, 2026-10-21: the answer gets a shape the code can check.

- **The shape:** `sure`; `action` with `kind` ("food", "several" or "not-a-food"), `joined` ("together" or "alternatives", for several) and `reason` ("equipment", "preparation", "note" or "gibberish", for not a food); and `foods[]`, each with `written` (in the language written), `englishName`, `parent` (ticket 27) and `otherNames`.
- **Checked by the code:** a food has one entry in `foods`, several have two or more and a `joined`, not a food has none and a `reason`. An answer that breaks this is asked once more, then the food is flagged. One flat object, not a choice of schemas, since OpenAI's strict mode refuses a choice at the top.
- **The prompt:** several foods also covers foods written side by side with no joining word ("salt cinnamon" is salt and cinnamon).
- **A split's parts** are looked up by their English names and other names, as a single food is.
- **Upgrade notes:** an administrator who edited the `ingredient-resolution` Prompt checks it against the new answer.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] "salt cinnamon" and "koud water melk" are split into their foods, not deleted.
- [ ] An answer that breaks the shape is asked once more, then flagged.
- [ ] All `CONTRIBUTING.md` gates pass.
