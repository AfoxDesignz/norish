/**
 * Where the resolver says it minted Ingredients for someone's action, so the
 * AI pass can follow without the resolver knowing of it. The queue listens
 * from startup; nothing listens otherwise, in tests or tools. The seed and
 * the recheck never announce: they mint or rename with AI off, and must not
 * spend a request per food.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { createLogger } from "@norish/shared-server/logger";

const log = createLogger("ingredients");

type MintedListener = (ingredientIds: string[]) => Promise<void>;

/**
 * The listener and the held mints, on `globalThis` under `Symbol.for` keys, as the change
 * publisher holds its batches, so a bundler that copies this module into two
 * chunks still keeps one.
 */
const LISTENER_KEY = Symbol.for("norish:ingredients-minted");
const HELD_KEY = Symbol.for("norish:ingredients-minted-held");
const g = globalThis as {
  [LISTENER_KEY]?: MintedListener;
  [HELD_KEY]?: AsyncLocalStorage<string[]>;
};
const held = (g[HELD_KEY] ??= new AsyncLocalStorage<string[]>());

/** Listen for new Ingredients, replacing any listener before. */
export function onIngredientsMinted(listener: MintedListener | undefined): void {
  g[LISTENER_KEY] = listener;
}

/** Say these Ingredients were just minted. Never rejects: the mint has been written by now. */
export async function announceMinted(ingredientIds: readonly string[]): Promise<void> {
  const listener = g[LISTENER_KEY];

  if (!listener || ingredientIds.length === 0) return;
  const holding = held.getStore();

  if (holding) return void holding.push(...ingredientIds);
  try {
    await listener([...ingredientIds]);
  } catch (error) {
    log.warn({ err: error, ingredientIds }, "Could not hand new Ingredients on");
  }
}

/**
 * Run a resolve and the write it makes, announcing its mints once the write is done: the pass
 * reads which rows name a food, so it must not read them before they are written.
 */
export async function announcingAfter<T>(run: () => Promise<T>): Promise<T> {
  const minted: string[] = [];

  try {
    return await held.run(minted, run);
  } finally {
    await announceMinted(minted);
  }
}
