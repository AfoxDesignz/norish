# A spelling may name several foods

Recipes write "salt and pepper", "zout en peper", "chicken or tofu" and "prosciutto crudo o speck" on one line. Under ADR-0037 a spelling points at one Ingredient, so such a line became a food of its own, filed under whichever food the words happened to end on: "salt and pepper" under pepper, "zout en peper" under salt. A Pantry holding salt and pepper never covered it, and adding the recipe to the groceries put a "salt and pepper" on the list.

**An Ingredient Alias may be a Compound Spelling: it names several Ingredients, in order, either all of them ("and") or any one of them ("or").** The line keeps its text and its one alias, as every line does. What reads a line's food reads several:

- The Pantry covers an "and" line when every food is kept, an "or" line when any one is.
- Adding the recipe to the groceries puts each food on the list as a Grocery of its own; for an "or", all but the first start unticked, and the screen says why. Each Grocery so made has one food, so its price and Aisle are looked up as any other's. A Grocery typed as a Compound Spelling is priced and filed as its first food.
- The icon is the first food's. Nutrition takes the first food's numbers for an "or" and leaves an "and" out of the total, named as a line that names several foods.

It is a fact about the spelling, not the line, because that is where ADR-0037 keeps meaning: one text is decided once, every line that writes it means the same, and the next one is found at rung 1 without asking anyone. Moving the spelling to a single Ingredient makes it an ordinary spelling of that food again, which is how a wrong split ("mac and cheese") is undone.

A new name is split by its words alone when every part is a food Norish knows and the word between them means "and" or "or" in the language the name was written in. The Ingredient Words read every language together, which is right for stripping but wrong here: Dutch "of" is "or" and English "of" is not, and Dutch "en" is Spanish "in", so "juice of lemon" would split into juice or lemon. The language is worked out rather than recorded, since a recipe's language is deliberately not stored: a recipe's is the majority among the languages of the seeded spellings its other lines found, and a Grocery's or a Pantry Ingredient's is that of the person typing. Where that settles nothing, AI reads the name in the background (ADR-0037, amended 2026-10-16), and where AI is off or unsure the mint is flagged with a suggestion to split it, for a person to split or keep as one food. A name the catalogue already knows as one food ("sweet and sour sauce", "salt and vinegar crisps") matches exactly first and is never split.

## Considered options

- **The first food named.** Right for "or", but an "and" line loses its second food: a Pantry with salt covers "salt and pepper" and pepper is never bought.
- **A line points at several aliases.** Each line would be decided on its own, so the same text would be asked about again per line, and a merge or unmerge would no longer move every line behind a spelling.
- **Splitting the line in two.** Rewrites the recipe, which no fix may do.
