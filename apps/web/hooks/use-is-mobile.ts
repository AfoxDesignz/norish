"use client";

import { useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint — below this the layout is treated as mobile. */
const MOBILE_MAX_WIDTH = 768;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);

  return () => window.removeEventListener("resize", onChange);
}

/**
 * Whether the viewport is below the mobile breakpoint. Returns `false` on the
 * server and while hydrating (so SSR markup is stable), then follows the
 * viewport and its resizes.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_MAX_WIDTH,
    () => false
  );
}
