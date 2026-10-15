"use client";

import { useMediaQuery } from "@/hooks/use-media-query";

export function useIsDesktopCookingMode() {
  return useMediaQuery("(min-width: 768px)");
}
