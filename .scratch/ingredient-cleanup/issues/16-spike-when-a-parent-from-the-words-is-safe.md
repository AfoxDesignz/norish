# 16 (spike): When is a parent from the words safe?

**Question:** A new food that the words of its name file under a known food ("verse peterselie" under peterselie, "garlic cloves crushed" under garlic) is an unsure entry on Changed by AI. It flags the food, unless the known food's spelling ends the name. Mike, 2026-10-20: "I think we can make some algorithm and when to say this is save to not flag". Find a rule saying when a parent from the words is safe enough to file without a flag.

**How:**

- Run the words' parent over every line and own food on the production copy (Mike's real set, not the Italian slice).
- Mark each parent right or wrong by hand.
- Test candidate signals:
  - the parent's spelling ends the name (today's rule);
  - the other words are only preparation, size or colour words from the Ingredient Words ("verse", "gehakte", "large");
  - the parent is a seeded food with no children yet;
  - the name and the parent's spelling are in the same language.
- Write down:
  - the rule;
  - how many flags it removes;
  - every wrong parent it would file without a flag.

Only a measuring script, no product code. The result is a ticket for the rule, or a note that today's rule stays.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] The real set's words-parents are listed with right or wrong, in this ticket's comments.
- [ ] The proposed rule, its flags removed and its misses are written down, for Mike to decide.
