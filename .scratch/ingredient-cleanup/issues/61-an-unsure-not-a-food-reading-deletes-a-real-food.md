# 61: An unsure "not a food" reading deletes a real food

**What to build:** Found by ticket 31's run after tickets 57, 58 and 60 (2026-10-22, HEAD 67eb2082a, `m60_post_on`). AI read a product name it did not know as gibberish, unsure. Mike's rule (128077595) deletes a food AI calls not a food, sure or not, so the food went and its recipe line now names no food. Last run the same name was read, unsure, as the food it is and merged into it.

On the copy: 1 food, 1 recipe line. Ticket 59's deleted split part is the same rule on a part minted by a split.

To decide: does an unsure "not a food" still delete, or is it flagged like any other unsure answer?

**Blocked by:** None

**Status:** needs-triage
