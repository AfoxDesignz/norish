/**
 * The pass over the Flagged Ingredients an instance's history left behind:
 * the mints made before the resolver read "salt to taste" as salt, or filed
 * "verse peterselie" under peterselie (ADR-0037 as amended by ADR-0039). It
 * runs once per `RUNG_VERSION`, so lines on legacy recipes reach the seeded
 * Ingredients each time the rules for reading a name improve, without AI,
 * and once after the first seed, for what was minted before there was one.
 *
 * For every flagged mint no person decided about (`listUndecidedMints`), in
 * the order they were minted: where its spellings now resolve, by the
 * resolver's first two rungs, to one other Ingredient, it is merged there,
 * and its lines follow their aliases; where they name none, it takes the
 * plain name the resolver would mint it under today ("garlic cloves" for
 * "garlic cloves crushed"), so the sibling mints after it ("garlic cloves
 * thinly sliced") resolve to it and merge, and is filed under the seeded
 * spelling its name contains, staying flagged — an unsure AI Change where
 * the spelling is not what the name ends with; a parent that is still such
 * a guess is read again, and moves or goes; where they name several, it is
 * left for a person.
 * Nothing here is the resolver's rules over again: it asks the resolver.
 */
import { withTransaction } from "@norish/db/drizzle";
import { mergeCatalogueIngredients } from "@norish/db/repositories/ingredient-relocation";
import {
  adoptPlainName,
  fileUndecidedMint,
  listUndecidedMints,
} from "@norish/db/repositories/ingredient-seed";

import { findOtherFoodsNamed, parentFromWordsOf, plainNameOf, RUNG_VERSION } from "../resolver";
import { oncePerVersion } from "./catalogue-seed";

export interface RecheckOutcome {
  merged: number;
  filed: number;
}

/** Look at every undecided mint again under the current rules. */
export async function recheckUndecidedMints(): Promise<RecheckOutcome> {
  const outcome: RecheckOutcome = { merged: 0, filed: 0 };

  for (const mint of await listUndecidedMints()) {
    const found = await findOtherFoodsNamed(mint.id, mint.aliases, { slips: false });
    const targets = new Set(found.flatMap((food) => (food ? [food.ingredientId] : [])));

    if (targets.size === 1) {
      const [target] = targets;

      // Into a seeded food, or into an earlier undecided mint: that one stays flagged.
      if (
        await withTransaction((tx) =>
          mergeCatalogueIngredients(tx, mint.id, target!, { keepFlag: true })
        )
      ) {
        outcome.merged += 1;
      }
      continue;
    }
    if (targets.size > 1) continue;

    const plain = await plainNameOf(mint.name);

    if (plain) await adoptPlainName(mint.id, plain);
    // A parent AI gave or took is AI's to change; a guess from the words is read again.
    if (mint.answered || (mint.parentId !== null && !mint.guessed)) continue;

    const parent = await parentFromWordsOf(mint.name);
    const parentId = parent?.id ?? null;

    if (
      parentId !== mint.parentId &&
      (await fileUndecidedMint(mint.id, parentId, {
        unsure: !parent?.sure,
        expectedParentId: mint.parentId,
      }))
    ) {
      outcome.filed += 1;
    }
  }

  return outcome;
}

/**
 * The pass, where the resolver's rules changed since it last ran. The rung
 * version is recorded only once the pass is through, so a failure is retried
 * in full at the next boot.
 */
export async function recheckUndecidedMintsOnRungChange(): Promise<RecheckOutcome | null> {
  return await oncePerVersion("rungVersion", RUNG_VERSION, {
    pass: recheckUndecidedMints,
    // Merges and parents change which food lines mean.
    changed: (outcome) => outcome.merged > 0 || outcome.filed > 0,
    done: "Undecided mints looked at again",
  });
}
