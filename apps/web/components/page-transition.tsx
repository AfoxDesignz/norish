"use client";

import type { ComponentProps, ReactNode } from "react";
import { ViewTransition } from "react";
import Link from "next/link";
import { arriveWhereLeft } from "@/lib/scroll-memory";

// The type for going back; styles/globals.css slides those pages in from the left.
export const NAV_BACK = ["nav-back"];

/**
 * The template of `(app)` and of `recipes`, so every navigation remounts one and slides it (`.page`
 * in globals.css). The div gives the browser one box per page to capture, whatever the page renders.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" enter="page" exit="page">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}

/**
 * A link to where the reader came from: it slides in from the left and returns the page to where
 * it was scrolled, instead of Next's scroll to the top.
 */
export function BackLink({
  href,
  onNavigate,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  return (
    <Link
      {...props}
      href={href}
      scroll={false}
      transitionTypes={NAV_BACK}
      onNavigate={(event) => {
        onNavigate?.(event);
        arriveWhereLeft(href);
      }}
    />
  );
}
