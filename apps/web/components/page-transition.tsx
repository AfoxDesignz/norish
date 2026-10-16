"use client";

import type { ComponentProps, ReactNode } from "react";
import { useLayoutEffect, ViewTransition } from "react";
import Link from "next/link";
import { siteConfig } from "@/config/site";

// The type for going back; styles/globals.css slides those pages in from the left.
const NAV_BACK = ["nav-back"];
// The navbar's tabs, left to right.
const TABS = [...siteConfig.navItems.map((item) => item.href), "/settings"];

// Each path's last scroll position, so a back link can return a page to it.
const scrollTops = new Map<string, number>();
const arrival = { restoresScroll: false, tappedMidSlide: false };

if (typeof window !== "undefined") {
  addEventListener("scroll", () => scrollTops.set(location.pathname, scrollY), { passive: true });

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
  useLayoutEffect(() => {
    if (!arrival.restoresScroll) return;
    arrival.restoresScroll = false;
    scrollTo(0, scrollTops.get(location.pathname) ?? 0);
  }, []);

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
export function BackLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      scroll={false}
      transitionTypes={NAV_BACK}
      onNavigate={(event) => {
        onNavigate?.(event);
        arrival.restoresScroll = true;
      }}
    />
  );
}

/** Which navbar tab a path belongs to, left to right, or -1 when it is none of them. */
export function tabIndex(path: string) {
  const pathname = path.split("?")[0] ?? path;

  return TABS.findIndex(
    (tab) => pathname === tab || (tab !== "/" && pathname.startsWith(`${tab}/`))
  );
}

/** A navbar tab's transition types: a tab left of the current page slides in from the left. */
export function tabTransitionTypes(pathname: string, href: string) {
  return tabIndex(href) < tabIndex(pathname) ? NAV_BACK : undefined;
}
