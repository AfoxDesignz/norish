# 45: A split part AI found nothing for takes no slip

**What to build:** Found by the audit of ticket 31's final run (2026-10-22, `m31c_post_on`; ticket 41 names it). "vegatine of agar agar" was split, and its "agar agar" part ended up on barley.

**The path.** AI read the food as two alternatives. For "agar agar", AI's names found no exact spelling, only slips; the second question (Decision) answered none of them (0.98). So `askWhatFoodThisIs` handed the part over with `found: null`. Then:

- `split()` in `review.ts` resolves every part without a found food through `resolveParts(…, { userId: food.ownerId })`;
- `resolveParts` calls `resolveIngredients(texts, actor)` with no options;
- `resolveTexts` (`resolver.ts`) runs the import's rung 3, `findSlips(options.mint === false ? [] : unknown)`, and `onlyNearest` took barley's Basque spelling "garagar".

So the slip AI had just refused was taken anyway, unasked. Ticket 26's rule is that in AI's pass a slip is only taken through the second question.

**Fix (Mike, 2026-10-22):** a part AI's names found nothing for becomes a food of its own: rungs 1–2, else a mint, never a slip. AI's pass reads that mint next, as it reads every mint (`announceMinted`).

- `ResolveOptions` gets `slips?: boolean`. When it is off, `resolveTexts` skips `findSlips`. `resolveParts` takes the options and passes them on, and `split()` passes `{ slips: false }`.
- A part the second question picked a slip for is never `sure` (`isExact`), so today it also reaches `resolveParts` as text, where it takes the nearest slip by itself. Hand the part the food AI picked (`found: found.food`, not only when sure), so it keeps AI's pick and not a mint.
- The import's own `resolveParts` call (`recipe-lines.ts`, the texts the import's AI named) keeps rung 3 unchanged.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] "vegatine of agar agar", whose "agar agar" only finds the slip "garagar" and the second question answers none, splits into vegatine and a new food "agar agar", which AI's pass is asked about. Barley is unchanged.
- [ ] A part whose slip the second question picks is still split onto that food.
- [ ] An import line that is a slip of a known food still takes that food (rung 3).
