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
  | { outcome: "skipped"; reason: "decided" | "undone" };

export interface ReviewTrace {
  /** The names of the foods AI was asked to compare the name with, in order. */
  considered: string[];
  /** The plain English food AI read the name as, when it said. */
  englishName: string | null;
}

/** What a round of Ask AI came to for one food, as its step records it: the change, the skip or the error. */
export type ReviewReportEntry = { ingredientId: string; name?: string; mode?: ReviewMode } & (
  | ({ outcome: "merge"; into: string; sure?: boolean } & ReviewTrace)
  | ({ outcome: "parent"; of: string; sure?: boolean } & ReviewTrace)
  | ({ outcome: "distinct" } & ReviewTrace)
  | ({ outcome: "unsure"; reason: string } & ReviewTrace)
  | PlainNameEntry
  | {
      outcome: "skipped";
      reason: "decided" | "undone" | "forbidden" | "not-found" | "settled";
    }
  | { outcome: "failed"; error: string }
);

/** The outcomes a round makes no change for: Changed by AI lists them under the changes. */
export const UNCHANGED_OUTCOMES: ReadonlySet<ReviewReportEntry["outcome"]> = new Set([
  "unsure",
  "skipped",
  "failed",
]);

/** What a round of Clean names came to for one food beyond a merge: a rename, or the name already plain. */
export type PlainNameEntry = { outcome: "rename"; to: string } | { outcome: "plain" };

/**
 * A round of Ask AI read back: what it came to for each food, in the order it
 * took them, and while it runs, the foods it has still to ask about.
 */
export interface ReviewReport {
  jobId: string;
  finished: boolean;
  entries: ReviewReportEntry[];
  waiting: Array<{ ingredientId: string; name: string }>;
}

/** What a round of Ask AI asks of each food: what it is, what it is a kind of, or its Plain Name. */
export type ReviewMode = "review" | "parent" | "name";

/** What a round of Fix catalogue asks about: the flagged foods, and the unflagged ones with unsettled names. */
export const FIX_PARTS = ["flagged", "name"] as const;

export type FixPart = (typeof FIX_PARTS)[number];

/** About how many tokens one food's question takes on one model. */
export interface ModelTokenEstimate {
  provider: string;
  model: string;
  perFood: number;
}

/**
 * About how many tokens one food's question takes, per model it asks:
 * measured over the last round, as the providers reported them; or, before
 * any round was measured, counted from what would be sent, which leaves out
 * a model's reasoning.
 */
export type ReviewTokenEstimate =
  | { basis: "measured"; foods: number; models: ModelTokenEstimate[] }
  | { basis: "prompt"; models: ModelTokenEstimate[] };

/** How many flagged foods a round of Fix catalogue would ask about, and the tokens a food takes. */
export interface ReviewScopeSummary {
  flagged: number;
  tokens: ReviewTokenEstimate;
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

/**
 * What a round of Clean names would ask about, for the asker: how many
 * unflagged foods whose names are not settled, and the tokens a food takes.
 */
export interface NameScopeSummary {
  foods: number;
  tokens: ReviewTokenEstimate;
}
