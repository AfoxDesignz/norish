"use client";

import type { ComponentProps, ReactNode } from "react";
import { ViewTransition } from "react";
import Link from "next/link";
import { arriveWhereLeft } from "@/lib/scroll-memory";

// The type for going back; styles/globals.css slides those pages in from the left.
export const NAV_BACK = ["nav-back"];

const arrival = { tappedMidSlide: false };

if (typeof window !== "undefined") {
  // Named view-transition layers ignore hits while they animate, so a tap then lands on whatever
  // unnamed box is behind them: hold its click and replay it on what is under the pointer after.
  const isSliding = () => document.documentElement.matches(":active-view-transition");
  const replay = (x: number, y: number) => {
    if (isSliding()) return void requestAnimationFrame(() => replay(x, y));
    document
      .elementFromPoint(x, y)
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
  };

  addEventListener("pointerdown", () => (arrival.tappedMidSlide = isSliding()), { capture: true });
  addEventListener(
    "click",
    (event) => {
      if (!arrival.tappedMidSlide || !event.isTrusted) return;
      arrival.tappedMidSlide = false;
      event.preventDefault();
      event.stopPropagation();
      replay(event.clientX, event.clientY);
    },
    { capture: true }
  );
}

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
