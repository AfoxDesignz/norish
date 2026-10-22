# 38: The second question picks an unrelated slip

**What to build:** Found by ticket 31's final run (2026-10-22, HEAD 0dab43bd8). With AI on, one of ticket 26's two cases was merged again into the unrelated food ticket 26 named, unsure. AI's reading was right (its English name and parent are a different dish), none of its names is a food in the catalogue, so the one slip was put to the second question, and this time the answer picked it instead of "none of these". The two earlier runs of ticket 31 answered none; the answer varies per run.

- On the production copy: 1 unsure merge into an unrelated food, its recipe lines now on that food until someone presses Undo; the target flagged `ai-unsure`.
- To decide: whether a slip only becomes a candidate when it is near AI's name (not only the food's own spelling), or the second question is put to the language model rather than the Decision, or a slip AI picks stays a suggestion instead of a merge.

**Blocked by:** None

**Status:** needs-triage

- [ ] A food whose AI names find only an unrelated slip is not merged into it.
