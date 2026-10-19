/**
 * Plain Names (CONTEXT.md): AI renames a food to its plain name as an AI Change, or merges it into
 * the food already spelling that name; a settled name is never asked about again.
 */
import type { PlainNameEntry, ReviewTrace } from "@norish/shared/contracts/ingredient-catalogue";
import {
  findCatalogueIngredient,
  findIngredientHolding,
  listCatalogueAliasesOf,
  listUnsettledNameIngredients,
  settleIngredientName,
} from "@norish/db/repositories/ingredient-catalogue";
import { getIngredientPermissionPolicy } from "@norish/shared-server/config/server-config-loader";
import { createLogger } from "@norish/shared-server/logger";
import { ingredientAliasFold } from "@norish/shared/lib/spelling-keys";

import type { CatalogueActor } from "./catalogue";
import { readPlainName } from "../ai/resolution/plain-name";
import { mergeByAI, renameByAI } from "./ai-changes";
import { editableIngredient, mayEditIngredientRow } from "./catalogue";
import { ingredientChanges } from "./changes";
import { cleanIngredientText } from "./resolver";

const log = createLogger("ingredients");

/** No foods compared, nothing read as English: what a Plain Name question records beside a merge or a doubt. */
const NO_TRACE: ReviewTrace = { considered: [], englishName: null };

/** What asking for one food's Plain Name came to, or why the food was passed over. */
export type PlainNameOutcome =
  | PlainNameEntry
  | ({ outcome: "merge"; into: string; sure: true } & ReviewTrace)
  | ({ outcome: "unsure"; reason: "no-food" } & ReviewTrace)
  | { outcome: "skipped"; reason: "settled" | "decided" | "undone" };

/** The foods a round of Clean names asks about for the actor: those they may edit, by name. */
export async function listNameableIngredients(
  actor: CatalogueActor
): Promise<Array<{ id: string; name: string }>> {
  const [rows, policy] = await Promise.all([
    listUnsettledNameIngredients(),
    getIngredientPermissionPolicy(),
  ]);

  return rows
    .filter((row) => mayEditIngredientRow(policy.edit, actor, row.ownerId))
    .map(({ id, name }) => ({ id, name }));
}

/** Ask for a food's Plain Name and make it, as a just-minted food's last step too; throws what the question throws. */
export async function giveItsPlainName(ingredientId: string): Promise<PlainNameOutcome> {
  const row = await findCatalogueIngredient(ingredientId);

  if (!row || row.nameSettled) return { outcome: "skipped", reason: "settled" };
  if (!row.askable) return { outcome: "skipped", reason: "decided" };

  const spellings = await listCatalogueAliasesOf(ingredientId);
  const read = await readPlainName(
    row.name,
    spellings.map((spelling) => spelling.text)
  );
  const plain = read ? cleanIngredientText(read) : "";

  if (!plain) return { outcome: "unsure", reason: "no-food", ...NO_TRACE };
  if (plain === row.name) {
    if (await settleIngredientName(ingredientId)) await ingredientChanges().changed([ingredientId]);

    return { outcome: "plain" };
  }

  const holder = await findIngredientHolding(plain, ingredientAliasFold(plain), ingredientId);

  if (holder) {
    const merged = await mergeByAI(ingredientId, holder.id, true);

    if (merged === "applied") {
      return { outcome: "merge", into: holder.name, sure: true, ...NO_TRACE };
    }

    return { outcome: "skipped", reason: merged === "undone" ? "undone" : "settled" };
  }

  return (await renameByAI(ingredientId, row.name, plain))
    ? { outcome: "rename", to: plain }
    : { outcome: "skipped", reason: "settled" };
}

/** A round of Clean names asking one food for its Plain Name. Follows `edit` on the Ingredient. */
export async function cleanNameWithAI(
  actor: CatalogueActor,
  ingredientId: string
): Promise<PlainNameOutcome> {
  await editableIngredient(actor, ingredientId);

  return await giveItsPlainName(ingredientId);
}

/** The Plain Name step after AI's answer: the rename or merge, or null; a broken question changes nothing. */
export async function nameAfterAnswer(
  ingredientId: string
): Promise<Extract<PlainNameOutcome, { outcome: "rename" | "merge" }> | null> {
  const named = await giveItsPlainName(ingredientId).catch((error: unknown) => {
    log.warn({ err: error, ingredientId }, "Asking a food's Plain Name failed");

    return null;
  });

  return named?.outcome === "rename" || named?.outcome === "merge" ? named : null;
}
