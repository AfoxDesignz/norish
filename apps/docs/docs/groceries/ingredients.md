---
sidebar_position: 4
title: Ingredients
description: The food catalogue behind aisles, prices, the pantry and nutrition.
---

# Ingredients

Norish keeps a catalogue of **ingredients** for the whole server. Each
ingredient is one food, with its names in other languages and its nutrition
when known. So:

- an [aisle](./aisles.md) set for "onion" also works for "onions" and "ui"
- a [product](./prices.md) linked to "milk" also works for "melk"
- "onion" in the [pantry](./pantry.md) also covers its translations

Find it under **Settings => Ingredients**.

## Catalogue source

Norish starts from the [Open Food Facts](https://world.openfoodfacts.org)
ingredients list and refreshes it every night.

A new name from a recipe, grocery or pantry is matched to an existing
ingredient, ignoring plurals, amounts, units, preparation and stray marks.
"finely chopped onions" matches "onion", "4 el bosui" matches "bosui",
"gyoza vellen ((ontdooid))" matches "gyoza vellen", and the slip "barmezaan"
matches "parmezaan". A name that joins foods names each of them: "zout en
peper" is salt and pepper, and "boter of olie" is butter or oil. A name nothing
matches becomes a new ingredient, under its clean name.

![The Ingredients page, with a flagged ingredient](/img/screenshots/ingredients-page.png)

An ingredient filed under a parent uses the parent's aisle, nutrition and icon
until it has its own.

## AI keeps the catalogue

When AI is set up, it looks at every new ingredient by itself, moments after a
recipe, grocery or pantry item adds it. It then does one of these:

- merges it into the food it is ("uien" into "onion"). A food only spelled
  like it, a letter or two apart, is merged only when AI picks it
- files it under a parent ("cherry tomatoes" under "tomato"), or takes away
  one its name gave it that it is no kind of ("peanut butter" under "butter")
- gives it a clean name ("GR OF CANNED TUNA" becomes "Canned Tuna")
- splits a name that is several foods ("Dijon or yellow mustard", or "salt
  cinnamon" with no joining word). A spelling of one of those foods that it
  also has becomes an ingredient of its own
- deletes it when it is not a food, like a tool ("deegroller") or a fragment
  of a line ("melted"). Recipe lines and groceries keep their text.

AI leaves alone an ingredient you marked distinct, renamed or gave a parent,
and every ingredient from the catalogue source. Ingredients AI could not reach
are tried again every night.

### Changed by AI

**Changed by AI** at the top of the page lists everything AI did in the last
month. Changes AI was not sure of come first, with **Keep** and **Undo**, and
flag their ingredient until you choose. **Undo** puts back what the change took,
deleted ingredients and their lines included, and AI never makes that change
again.

![Changed by AI](/img/screenshots/ingredients-changed-by-ai.png)

## Deleting

**Delete** in an ingredient's panel always works. The dialog says how many
recipe lines and groceries keep their text without it, and how many pantry
items go with it. Those lines and groceries are then read again: one whose text
names other foods points at them, so deleting a "kruidenmix" with the
translation "zout en peper" points a "zout en peper" line at salt and pepper,
and a "zout en peper" grocery becomes two. Nothing new is added. Removing a
translation moves what used it to another of the ingredient's names.

![Deleting an ingredient](/img/screenshots/ingredients-delete.png)

An ingredient someone added that nothing has used for three months is deleted
by itself. A recurring grocery counts as a use, so a grocery set to repeat
yearly keeps its ingredient.

## Data sources

The catalogue is built on the Open Food Facts ingredients taxonomy, under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
Nutrition comes from CIQUAL 2025 and CALNUT (ANSES), USDA FoodData Central and
CoFID.

![The Data sources section of the Ingredients page](/img/screenshots/ingredients-data-sources.png)

Administrators can point the nightly fetch at a mirror, or turn it off, with
[`INGREDIENT_CATALOGUE_URL`](../configuration/server-runtime.md#ingredient-catalogue).
