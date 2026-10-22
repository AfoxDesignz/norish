# 58: The lean reading prompt gives fewer other names and broader parents

**What to build:** Found by ticket 31's run after ticket 56 (2026-10-22, HEAD 44297d433, `m56_post_on`). With ticket 56's rewritten `ingredient-resolution` prompt, the same 573 names read in both runs came back with the same kind and sureness as last run, but with far fewer other names and looser parents:

- Other names: missing on 425 of 599 foods read (71%), against 173 of 596 (29%) last run. The pass finds the right existing food through the other names; without them, 39 own foods that last run merged, rightly, into an existing food (a Dutch word for caster sugar, whipping cream, allspice berries, dried thyme, garden peas, mixed salad, green pesto, and more) now stay own foods under their general food. 50 fewer sure merges in all (81, against 131). Listed own foods 443, against 388.
- Parents: `category` "spice" came back 24 times (7 last run), "mixed spices" 0 times (15). 5 powders lost a specific parent (cumin, garlic, chili pepper) for spice, one of them with 41 lines, and 9 blends moved to spice (7 from mixed spices, 2 from mixed condiments). 8 own foods lost a right parent because the parent or category AI gave finds no food (ticket 53's shape).
- Cheaper: reading tokens 698,706 against 977,068 for 579 against 573 readings.

Mike decided the prompt texts on 2026-10-22, so this is his call: put other names and the most specific parent back in the reading's asks (a `.describe()`, or the prompt), or look up the parent's children before filing.

**Blocked by:** None

**Status:** needs-triage
