import { useViewport } from "@/hooks/use-is-mobile";

/**
 * The library's column count from the window width, at Tailwind's `lg`
 * breakpoint: 2 on phones and tablets, 4 on desktops.
 */
export function useContainerColumns(): number {
  return useViewport((width) => (width < 1024 ? 2 : 4));
}
