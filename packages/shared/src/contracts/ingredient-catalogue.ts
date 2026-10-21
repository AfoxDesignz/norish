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
  /** Minted by an import or a save; AI's pass looks at it in the background. */
  "ai-queued",
  /** No known food shared a word with the name, so AI was not asked. No longer set; old rows keep it. */
  "unknown-food",
  /** AI was asked and was not sure. */
  "ai-unsure",
  /** AI did not answer in time, or failed. */
  "ai-unavailable",
  /** The AI provider rejected the configured API key. */
  "ai-key-rejected",
  /** AI or a slip named a food that was merged away before the name could join it. */
  "food-gone",
  /** Minted by the upgrade to the catalogue, which asks no AI. */
  "upgrade",
  /** The catalogue seed found several foods its spellings could be. */
  "seed-ambiguous",
  /** AI says this is not a food, and a Pantry Ingredient keeps it. */
  "ai-junk",
] as const;

export type FlagReason = (typeof FLAG_REASONS)[number];

/** Why a food is flagged when no AI could answer for it: unreachable, or its key refused. */
export const UNANSWERED_FLAG_REASONS: readonly FlagReason[] = ["ai-unavailable", "ai-key-rejected"];

/** Why a food is asked about again nightly: no AI answered for it, or its pass never came. */
export const RETRIED_FLAG_REASONS: readonly FlagReason[] = [
  ...UNANSWERED_FLAG_REASONS,
  "ai-queued",
];

export function isFlagReason(value: unknown): value is FlagReason {
  return (FLAG_REASONS as readonly unknown[]).includes(value);
}

/**
 * What an AI Change did: merged a food into another, filed it under a parent, gave it its Plain
 * Name, or deleted it as not a food.
 */
export const AI_CHANGE_KINDS = ["merge", "parent", "plain-name", "not-a-food"] as const;

export type AIChangeKind = (typeof AI_CHANGE_KINDS)[number];

/**
 * What asking AI about an Ingredient came to, with what AI tried (`ReviewTrace`). `unsure` changed
 * nothing: no answer came, or AI doubted the food is its own.
 */
export type ReviewOutcome = ReviewVerdict & ReviewTrace;

export type ReviewVerdict =
  | { outcome: "merge"; into: string; sure: boolean }
  | { outcome: "parent"; of: string; sure: boolean }
  | { outcome: "no-parent"; from: string; sure: boolean }
  | { outcome: "rename"; to: string }
  | { outcome: "split"; into: string[] }
  | { outcome: "not-a-food" }
  | { outcome: "distinct" }
  | { outcome: "unsure"; reason: FlagReason }
  | { outcome: "skipped"; reason: "decided" | "undone" | "not-found" };

export interface ReviewTrace {
  /** The plain English food AI read the name as, when it said. */
  englishName: string | null;
  /** The plain food AI said it is made of or sold as, its parent. */
  parent: string | null;
  /** The other names AI said a shop sells it under. */
  otherNames: string[];
  /** The foods AI read the name as several of, when it did. */
  parts: string[] | null;
  /** The foods AI's names found when they found several, which AI then chose between. */
  considered: string[];
}

/** A trace before AI said anything. */
export function noTrace(): ReviewTrace {
  return { englishName: null, parent: null, otherNames: [], parts: null, considered: [] };
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
