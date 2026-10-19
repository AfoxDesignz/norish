/**
 * Why the catalogue of Ingredients refused an edit (ADR-0037). The server
 * throws one of these and the Ingredients page translates it, so both read
 * the one list.
 */
export const CATALOGUE_REFUSALS = [
  "forbidden",
  "not-found",
  "name-taken",
  "spelling-taken",
  "last-alias",
  "same-ingredient",
  "cycle",
  "empty",
] as const;

export type CatalogueRefusal = (typeof CATALOGUE_REFUSALS)[number];

export function isCatalogueRefusal(value: unknown): value is CatalogueRefusal {
  return (CATALOGUE_REFUSALS as readonly unknown[]).includes(value);
}

/**
 * Why an Ingredient is flagged (ADR-0037): what the resolver, the upgrade or
 * the seed knew when it minted or marked it. The Ingredients page shows the
 * reason beside the flag so a person knows what to check.
 */
export const FLAG_REASONS = [
  /** AI is switched off, so nothing vouched for the name. */
  "ai-off",
  /** No known food shares a word with the name, so AI was not asked. */
  "unknown-food",
  /** AI was asked and was not sure. */
  "ai-unsure",
  /** AI did not answer in time, or failed. */
  "ai-unavailable",
  /** The AI provider rejected the configured API key. */
  "ai-key-rejected",
  /** AI named a food that was merged away before the name could join it. */
  "food-gone",
  /** Minted by the upgrade to the catalogue, which asks no AI. */
  "upgrade",
  /** The catalogue seed found several foods its spellings could be. */
  "seed-ambiguous",
] as const;

export type FlagReason = (typeof FLAG_REASONS)[number];

/** Why a food is flagged when no AI could answer for it: unreachable, or its key refused. */
export const UNANSWERED_FLAG_REASONS: readonly FlagReason[] = ["ai-unavailable", "ai-key-rejected"];

export function isFlagReason(value: unknown): value is FlagReason {
  return (FLAG_REASONS as readonly unknown[]).includes(value);
}

/** What an AI Change did: merged a food into another, filed it under a parent, or gave it its Plain Name. */
export const AI_CHANGE_KINDS = ["merge", "parent", "plain-name"] as const;

export type AIChangeKind = (typeof AI_CHANGE_KINDS)[number];

/**
 * What asking AI about an Ingredient came to, with what AI tried (`ReviewTrace`). `unsure` changed
 * nothing: no answer came, or AI doubted the food is its own.
 */
export type ReviewOutcome = ReviewVerdict & ReviewTrace;

export type ReviewVerdict =
  | { outcome: "merge"; into: string; sure: boolean }
  | { outcome: "parent"; of: string; sure: boolean }
  | { outcome: "rename"; to: string }
  | { outcome: "distinct" }
  | { outcome: "unsure"; reason: FlagReason }
  | { outcome: "skipped"; reason: "decided" | "undone" | "not-found" };

export interface ReviewTrace {
  /** The names of the foods AI was asked to compare the name with, in order. */
  considered: string[];
  /** The plain English food AI read the name as, when it said. */
  englishName: string | null;
}

/**
 * Which foods a Draw icons round draws: only those with no icon at all (the
 * default, which leaves a food that borrows its parent's alone), or every
 * food without one of its own. Either holds only foods the asker may edit,
 * and never a vague group the shipped set leaves without one.
 */
export const ICON_SCOPES = ["bare", "unowned"] as const;

export type IconScope = (typeof ICON_SCOPES)[number];

/** How many icons each scope of a Draw icons round would draw, for the asker. */
export type IconScopeSummary = Record<IconScope, number>;
