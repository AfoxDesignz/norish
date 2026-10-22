# 41: A split keeps the word its parts share

**What to build:** Found by the audit of ticket 31's final run (2026-10-22, `m31c_post_on`). 7 joined foods were split with a part on the wrong food (10 lines). Five of them lost the word both parts share:

- "chicken or vegetable stock" became chicken and vegetable broth;
- "vegetable or chicken broth" became vegetable and chicken broth;
- "cherry or grape tomatoes" became cherry and grape tomato;
- "zonnebloem- of kokosolie" became sunflower and coconut oil;
- "sap van citroen of limoen" became lemon juice and lime.

**The cause.** AI split none of the five: each has a 0.25 `parent_chosen`, so AI never read them (ticket 40). The first start's cleanup split them with AI off, in step 5 (`cleanUpCatalogue` → `partsByWordsOf` → `foodsByWords` in `packages/shared-server/src/ingredients/resolver.ts`). `joinedParts` cuts the name at the joining word, and each part is then read alone. A part that is one half of a shared head or tail ("cherry", "chicken", "vegetable", "zonnebloem-", "limoen") is a known food on its own, so the split is accepted. Recipe lines at import (`resolveLineFoods`) and typed groceries (`typedParts`) take the same path.

AI writes each part whole ("sticky or sushi rice" became sticky rice and sushi rice in the same run). The two other wrong splits are not this cause:

- "zaden en pitten": AI read seeds and kernels, and both are seed.
- "vegatine of agar agar" ended up on barley. The Decision answered that "agar agar" is none of the foods it was shown (0.98). The part was then resolved through the import resolver (`resolveParts` in `review.ts`), and its slip rung took barley's Basque spelling "garagar". That needs a ticket of its own if wanted.

**Fix (one rule, in `spelledParts` / `foodsByWords`):** where two parts differ in length, the shorter part is first read with the longer part's extra words. A shorter first part takes the longer part's last words ("cherry" becomes "cherry tomatoes", "chicken" becomes "chicken stock"). A shorter last part takes its first words ("thigh" in "chicken breast or thigh" becomes "chicken thigh"). That reading is the part wherever rungs 1–2 know it; else the part is read as written.

- A part ending in a hyphen borrows the same way at any length ("rode- en witte kool" gives "rode kool"). If the borrowed reading is unknown, the words refuse the split ("zonnebloem- of kokosolie" is left for AI).
- No `RUNG_VERSION` or `CLEANUP_VERSION` bump: only rc and dev instances ran the old split.
- A rough check over the copy's 214 lines that name several foods found no split this rule makes worse ("Snuf peper en zout" reads "snuf zout", which is still salt).
- It does not fix "sap van citroen of limoen": the catalogue has no spelling "sap van limoen", so lime stays.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] "cherry or grape tomatoes" names cherry tomato and grape tomato; "chicken or vegetable stock" names chicken broth and vegetable broth; "chicken breast or thigh" names chicken breast and chicken thigh. This holds at import and in the first start's split.
- [ ] The words do not split "zonnebloem- of kokosolie".
- [ ] "salt and black pepper" still names salt and black pepper.
