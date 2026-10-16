import { NAV_BACK } from "@/components/page-transition";
import { siteConfig } from "@/config/site";

export const SETTINGS_HREF = "/settings?tab=user";

// The navbar's tabs, left to right: the desktop bar shows the nav items, the phone bar adds Settings.
export const NAV_TABS = [...siteConfig.navItems.map((item) => item.href), SETTINGS_HREF];

export const NAV_LABEL_KEYS: Record<string, "home" | "calendar" | "groceries"> = {
  "/": "home",
  "/groceries": "groceries",
  "/calendar": "calendar",
};

const pathOf = (href: string) => href.split("?")[0] ?? href;

/** Which navbar tab a path belongs to, counted from the left, or -1 when it is none of them. */
export function navTabPosition(path: string) {
  const pathname = pathOf(path);

  return NAV_TABS.map(pathOf).findIndex(
    (tab) => pathname === tab || (tab !== "/" && pathname.startsWith(`${tab}/`))
  );
}

/** A tab's transition types: a tab left of the current page slides in from the left. */
export function tabTransitionTypes(pathname: string, href: string) {
  return navTabPosition(href) < navTabPosition(pathname) ? NAV_BACK : undefined;
}
