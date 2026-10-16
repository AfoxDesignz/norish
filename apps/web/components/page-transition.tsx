"use client";

import type { ComponentProps, ReactNode } from "react";
import { ViewTransition } from "react";
import Link from "next/link";
import { arriveWhereLeft } from "@/lib/scroll-memory";

// The transition type of a link back; globals.css slides those pages in from the left.
export const NAV_BACK = ["nav-back"];
// Next's guide maps untyped navigations to none; here they slide forward, so every page moves.
const SLIDES = { "nav-back": "nav-back", default: "nav-forward" };

/**
 * The template of `(app)` and of `recipes`, so every navigation remounts one and slides it. The div
 * gives the browser one box per page to capture, whatever the page renders.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" enter={SLIDES} exit={SLIDES}>
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
