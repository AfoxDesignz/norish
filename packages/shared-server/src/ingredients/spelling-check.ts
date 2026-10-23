/**
 * AI checks the spellings people, merges and imports added to seeded foods (ADR-0037; ingredient-
 * cleanup ticket 46), once, at the first start with AI on; each removal or move an AI Change.
 */
import { withTransaction } from "@norish/db/drizzle";
import { listAliasIdsAIMovedOnto } from "@norish/db/repositories/ingredient-ai-changes";
import {
  findCatalogueIngredient,
  listCatalogueAliasesOf,
  listSeededFoodsWithOwnSpellings,
} from "@norish/db/repositories/ingredient-catalogue";
import { findRowsNamingSpellings } from "@norish/db/repositories/ingredient-cleanup";
import { isAIEnabled } from "@norish/shared-server/config/server-config-loader";
import { createLogger } from "@norish/shared-server/logger";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import type { ApplyOutcome } from "./ai-changes";
import { findFoodNamed } from "../ai/resolution/ingredient-resolution";
import { askWhatSpellingsName } from "../ai/resolution/spelling-check";
import { moveSpellingByAI, removeSpellingByAI } from "./ai-changes";
import { oncePerVersion } from "./seed/catalogue-seed";

const log = createLogger("ingredients");

/** Raised when a release needs the check to run again. */
export const SPELLING_CHECK_VERSION = 1;

interface Moved {
  spelling: string;
  to: string;
}

/** A spelling AI's answer would remove or move, left as it is: undone before, or gone meanwhile. */
interface Unchanged {
  spelling: string;
  because: Exclude<ApplyOutcome, "applied">;
}

/** What checking a food's spellings came to, by spelling text. */
export type SpellingCheckOutcome =
  | { outcome: "skipped"; reason: "not-found" | "none" | "ai-off" }
  | {
      outcome: "checked";
      kept: string[];
      removed: string[];
      moved: Moved[];
      unchanged: Unchanged[];
    };

/**
 * Queue every seeded food holding a spelling the seed did not give it for the check, once per
 * `SPELLING_CHECK_VERSION`; with AI off nothing is asked or recorded, so a later start asks.
 */
export async function checkSpellingsOnFirstStart(
  queue: (ingredientIds: string[]) => Promise<void>
): Promise<{ queued: number } | null> {
  return await oncePerVersion("spellingCheckVersion", SPELLING_CHECK_VERSION, {
    pass: async () => {
      if (!(await isAIEnabled())) {
        log.info("AI is off: the spellings added to seeded foods wait for a start with AI on");

        return null;
      }
      const ids = await listSeededFoodsWithOwnSpellings();

      await queue(ids);

      return { queued: ids.length };
    },
    // The checks run in the queue, and announce what they change themselves.
    changed: () => false,
    done: "Spellings added to seeded foods queued for AI",
  });
}

/** Ask AI which of the spellings added to a food name it, and take off or move the others. */
export async function checkSpellingsOf(ingredientId: string): Promise<SpellingCheckOutcome> {
  const food = await findCatalogueIngredient(ingredientId);

  if (!food) return { outcome: "skipped", reason: "not-found" };
  const own = ingredientAliasFold(food.name);
  // AI already judged the spellings its merges and moves put on the food.
  const byAI = new Set(await listAliasIdsAIMovedOnto(ingredientId));
  const spellings = (await listCatalogueAliasesOf(ingredientId)).filter(
    (alias) => !alias.seeded && !byAI.has(alias.id) && ingredientAliasFold(alias.text) !== own
  );

  if (spellings.length === 0) return { outcome: "skipped", reason: "none" };
  if (!(await isAIEnabled())) return { outcome: "skipped", reason: "ai-off" };
  const parent = food.parentId ? await findCatalogueIngredient(food.parentId) : null;
  const verdicts = await askWhatSpellingsName(
    { name: food.name, parent: parent?.name ?? null },
    // One line per spelling, so a fragment cut from a line is read in it.
    await withTransaction((tx) =>
      Promise.all(
        spellings.map(async (alias) => ({
          text: alias.text,
          line: (await findRowsNamingSpellings(tx, [alias.id])).lines[0]?.name ?? null,
        }))
      )
    )
  );
  const checked = {
    kept: [] as string[],
    removed: [] as string[],
    moved: [] as Moved[],
    unchanged: [] as Unchanged[],
  };
  // A change that did not apply is counted, not dropped.
  const applied = (spelling: string, outcome: ApplyOutcome) => {
    if (outcome === "applied") return true;
    checked.unchanged.push({ spelling, because: outcome });
    log.info({ food: food.name, spelling, because: outcome }, "A spelling AI questioned stays");

    return false;
  };

  for (const [index, alias] of spellings.entries()) {
    const verdict = verdicts[index]!;

    if (verdict.kind === "this-food") {
      checked.kept.push(alias.text);
      continue;
    }
    const named =
      verdict.kind === "other-food" && verdict.otherFood
        ? await findFoodNamed(verdict.otherFood, ingredientId)
        : { food: null };

    // The second question about AI's name got no answer: the spelling stays.
    if (!named) {
      checked.kept.push(alias.text);
      continue;
    }
    if (named.food) {
      const to = await findCatalogueIngredient(named.food.ingredientId);
      const moved = to ? await moveSpellingByAI(ingredientId, alias.id, to.id) : "gone";

      if (applied(alias.text, moved) && to)
        checked.moved.push({ spelling: alias.text, to: to.name });
      continue;
    }
    const notAFood = verdict.kind === "not-a-food";
    const removed = await removeSpellingByAI(ingredientId, alias.id, { notAFood });

    if (applied(alias.text, removed)) checked.removed.push(alias.text);
  }

  return { outcome: "checked", ...checked };
}
