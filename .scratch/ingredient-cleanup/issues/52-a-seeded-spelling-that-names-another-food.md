# 52: A seeded spelling that names another food decides AI's answer

**What to build:** Found by ticket 31's run after tickets 32-48 (2026-10-22, HEAD fa3fb4295, `m48_post_on`). Two seed spellings name a different food than the one they sit on, and AI's right reading lands on them:

- "chicken drumstick" (en) is a seeded spelling of chicken thigh. AI read an own drumstick food as "chicken drumsticks", other name "chicken drumstick", and the pass merged it, sure, into chicken thigh. A joined "thighs and/or drumsticks" food now names chicken thigh only. On the copy: 1 sure merge, about 4 drumstick lines now on chicken thigh.
- "steak" (fr) is a seeded spelling of patty. AI's parent "steak" filed a steak food, sure, under patty (it was under beef steak), and keeps another steak food there (flagged unsure). On the copy: 2 foods.

Ticket 21's seed corrections (`SPELLING_MOVES`) can move both; whether to is Mike's call (ticket 39 was a near-neighbour product and closed as wontfix).

**Blocked by:** None

**Status:** needs-triage
