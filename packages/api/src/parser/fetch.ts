import type { BrowserContext, Page } from "playwright-core";

import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";
import { getBrowser } from "@norish/api/obscura";
import { SERVER_CONFIG } from "@norish/config/env-config-server";
import { parserLogger as log } from "@norish/shared-server/logger";

/** How long a page that answered with something else is given to become itself. */
const SETTLE_TIMEOUT_MS = 15_000;
const SETTLE_POLL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The page, once it is the page rather than whatever stood in front of it. A
 * bot check answers the first navigation with a script and replaces itself
 * with the real page seconds later, so a caller that can tell the two apart is
 * given until the deadline to be handed the second one. Reading a page
 * mid-navigation throws, which is a page still becoming itself and counts as
 * unsettled.
 */
async function settledContent(page: Page, isSettled: (html: string) => boolean): Promise<string> {
  const read = async (): Promise<string | null> => {
    try {
      return await page.content();
    } catch {
      return null;
    }
  };
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let html = await read();

  while ((html === null || !isSettled(html)) && Date.now() < deadline) {
    await sleep(SETTLE_POLL_MS);
    html = await read();
  }

  return html ?? "";
}

/** A rendered page and the HTTP status its document last arrived with. */
export interface RenderedPage {
  /** Empty when Obscura produced no usable HTML */
  html: string;
  /**
   * The status of the main document's last navigation: a bot check that
   * answers 403 and then hands over the real page reports the real page's.
   * Null when no document response was seen.
   */
  status: number | null;
}

// `page.evaluate` runs in the page, where `document` exists; this package compiles without DOM types.
declare const document: { cookie: string };

/**
 * Render a page in Obscura and return its HTML.
 *
 * Obscura owns the browser identity, JavaScript execution, page settling,
 * stealth and tracker blocking. Norish adds exactly one thing: the requesting
 * user's Site Auth Tokens, in a context that belongs to this fetch alone.
 *
 * There is no second engine behind this. An empty string means Obscura
 * produced no usable HTML, and the import path reports that as a fetch failure.
 *
 * `isSettled` is the caller's own reading of whether the rendered HTML is the
 * page it asked for. Only a caller knows: a shop's bot check and a shop's
 * empty results page are the same two kilobytes to everyone else. Without it
 * the page is read once, the moment it loads, exactly as before.
 */
export async function fetchRenderedPage(
  targetUrl: string,
  tokens?: SiteAuthTokenDecryptedDto[],
  isSettled?: (html: string) => boolean
): Promise<string> {
  return (await renderPage(targetUrl, tokens, isSettled)).html;
}

/** `fetchRenderedPage`, keeping the status a site answered with, so a refusal can be named. */
export async function renderPage(
  targetUrl: string,
  tokens?: SiteAuthTokenDecryptedDto[],
  isSettled?: (html: string) => boolean
): Promise<RenderedPage> {
  // Only a web page reaches the browser, so a link stored before imports refused other schemes
  // (file:, gopher:) is never rendered.
  if (!/^https?:$/.test(URL.parse(targetUrl)?.protocol ?? "")) {
    log.warn({ url: targetUrl }, "Refused to render a link that is not a web page");

    return { html: "", status: null };
  }

  let context: BrowserContext | undefined;
  let status: number | null = null;

  try {
    const browser = await getBrowser();

    const cookieTokens = tokens?.filter((t) => t.type === "cookie") ?? [];

    // A fresh context per fetch, so one importer's tokens never reach another's page. No header
    // tokens: Obscura's stealth build sends extraHTTPHeaders to other sites' scripts, never the page.
    context = await browser.newContext();

    const page = await context.newPage();

    // Obscura never sends a cookie set over CDP (addCookies included) but does send one a page
    // sets, so the tokens are set from the target's own origin; its jar sends them to that host only.
    if (cookieTokens.length > 0) {
      await page.goto(new URL("/robots.txt", targetUrl).href, {
        waitUntil: "domcontentloaded",
        timeout: SERVER_CONFIG.OBSCURA_NAVIGATION_TIMEOUT_MS,
      });
      await page.evaluate(
        (cookies) => {
          for (const { name, value } of cookies) document.cookie = `${name}=${value}; path=/`;
        },
        cookieTokens.map(({ name, value }) => ({ name, value }))
      );
    }

    page.on("response", (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        status = response.status();
      }
    });

    const response = await page.goto(targetUrl, {
      waitUntil: "load",
      // The whole navigation budget. One deadline rather than a stack of them:
      // page settling is Obscura's job, and waiting past the navigation for a
      // page to become itself has its own deadline, SETTLE_TIMEOUT_MS, because only a
      // caller can tell that it has not.
      timeout: SERVER_CONFIG.OBSCURA_NAVIGATION_TIMEOUT_MS,
    });

    status ??= response?.status() ?? null;

    const html = isSettled ? await settledContent(page, isSettled) : await page.content();

    return { html, status };
  } catch (error) {
    log.warn({ err: error, url: targetUrl }, "Obscura could not render the page");

    return { html: "", status };
  } finally {
    if (context) {
      await context.close().catch((err) => {
        log.debug({ err }, "Failed to close the Obscura browser context during cleanup");
      });
    }
  }
}
