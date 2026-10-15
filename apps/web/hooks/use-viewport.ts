"use client";

import { useSyncExternalStore } from "react";
import { useDeviceKind } from "@/context/device-preferences-context";

/** The window width the server and the hydrating render assume for each Device Kind. */
const DEVICE_KIND_WIDTH = { phone: 390, desktop: 1024 } as const;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);

  return () => window.removeEventListener("resize", onChange);
}

/**
 * `read` of the window width: the Device Kind's width on the server and while
 * hydrating, the window's after. A primitive answer keeps the snapshot stable.
 */
export function useViewport<T extends boolean | number>(read: (width: number) => T): T {
  const kind = useDeviceKind();

  return useSyncExternalStore(
    subscribe,
    () => read(window.innerWidth),
    () => read(DEVICE_KIND_WIDTH[kind])
  );
}
