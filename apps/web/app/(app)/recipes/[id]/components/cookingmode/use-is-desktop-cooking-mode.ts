"use client";

import { useIsMobile } from "@/hooks/use-is-mobile";

export function useIsDesktopCookingMode() {
  return !useIsMobile();
}
