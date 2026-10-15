"use client";

import { useSyncExternalStore } from "react";
import { useDeviceKind } from "@/context/device-preferences-context";

/** Tailwind's `md` breakpoint — below this the layout is treated as mobile. */
const MOBILE_MAX_WIDTH = 768;
/** The window width the server and the hydrating render assume for each Device Kind. */
const DEVICE_KIND_WIDTH = { phone: 390, desktop: 1024 } as const;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);

  return () => window.removeEventListener("resize", onChange);
}

/**
 * `read` applied to the window width. The server and the hydrating render
 * answer for the reader's Device Kind, so a phone gets its layout on the first
 * frame; after hydration it follows the window and its resizes.
 */
export function useViewport<T>(read: (width: number) => T): T {
  const kind = useDeviceKind();

  return useSyncExternalStore(
    subscribe,
    () => read(window.innerWidth),
    () => read(DEVICE_KIND_WIDTH[kind])
  );
}

/** Whether the viewport is below the mobile breakpoint. */
export function useIsMobile(): boolean {
  return useViewport((width) => width < MOBILE_MAX_WIDTH);
}
