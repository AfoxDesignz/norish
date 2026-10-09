---
sidebar_position: 4
title: Ingredients
description: The food catalogue.
---

# Ingredients

Norish keeps a catalogue of **ingredients** per instance. Each ingredient is one food with translations
and optionally macros.

- An [aisle](./aisles.md) you set “onion” in also works for: “onions” and “ui”.
- A [product](./prices.md) you link to “milk” works for “melk”.
- “Onion” in the [pantry](./pantry.md) also covers the translations.

The ingredient page can be found under: **Settings => Ingredients**

## Where the catalogue comes from

By default Norish seeds from the: [Open Food Facts](https://world.openfoodfacts.org) ingredients
taxonomy. This is fetched and refreshed every night.

For new ingredients, we first try to match it to an existing ingredient accounting for translations, plurals, quantities, units, preparation instructions etc. For example, "finely chopped onions" matches "onion", while "4 el bosui" matches "bosui".

Optionally if no match is found AI can be used to determine where the ingredient should land.
These ingredients are than **flagged** for review.

![The Ingredients page, with a flagged ingredient](/img/screenshots/ingredients-page.png)

When an ingredient is linked to a parent ingredient it inherits: filed aisles, macros and ingredient icon.

## Data sources

The catalogue is built on the Open Food Facts ingredients taxonomy, available
under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/),
Ingredient nutrition comes from CIQUAL 2025 and CALNUT (ANSES), USDA FoodData Central and
CoFID.

![The Data sources section of the Ingredients page](/img/screenshots/ingredients-data-sources.png)

Administrators can point the nightly fetch at a mirror, or turn it off, with
[`INGREDIENT_CATALOGUE_URL`](../configuration/server-runtime.md#ingredient-catalogue).
