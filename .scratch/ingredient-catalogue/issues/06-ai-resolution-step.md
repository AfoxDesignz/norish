# 06: AI resolution step

**What to build:** Add rung 3 of the resolution order. When no alias matches, a Decision under a new Decision Use, *ingredient resolution*, is asked about the text. Its state is the text, and its candidates are the Ingredients whose aliases share a word with it. It answers *match X*, *new* or *new, child of X*; the *child of* answer is acted on in 09 and treated as *new* until then. A Clear Case above a named threshold constant is acted on: a sure match adds the text as an alias of X, so the next occurrence matches exactly. Below the threshold, or when the Decision Model is unconfigured or switched off for this use, a language-model request under a new administrator-editable Prompt answers the same question. An Ingredient minted after an unsure answer, or without AI, is flagged.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The *ingredient resolution* Decision Use exists in configuration and follows the global AI switch.
- [ ] A new Prompt with a shipped default is appended to per ADR-0016, and is editable in the admin prompt settings.
- [ ] The threshold is a named constant with a test at its boundary.
- [ ] Tests mock `decide` as the one AI seam, and mock the runtime for the language-model path. They cover a sure match, an unsure answer, no AI, and a Decision failure falling back to the language model.
- [ ] An import never fails because resolution's AI failed: it falls through to a flagged mint.
