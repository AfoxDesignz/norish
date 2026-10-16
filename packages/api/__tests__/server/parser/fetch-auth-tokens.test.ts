// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";
import { fetchRenderedPage } from "@norish/api/parser/fetch";

// ---------------------------------------------------------------------------
// Obscura is reached through Playwright; the browser object stays mocked so
// these tests describe what Norish injects, not how Obscura applies it.
// ---------------------------------------------------------------------------
const { mockAddCookies, mockEvaluate, mockGoto, mockNewContext, mockGetBrowser } = vi.hoisted(
  () => {
    const mockAddCookies = vi.fn();
    const mockEvaluate = vi.fn().mockResolvedValue(undefined);
    const mockGoto = vi.fn().mockResolvedValue(undefined);
    const mockContent = vi.fn().mockResolvedValue("<html>test</html>");
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockNewPage = vi.fn();
    const mockNewContext = vi.fn().mockImplementation(async () => ({
      addCookies: mockAddCookies,
      newPage: mockNewPage.mockResolvedValue({
        goto: mockGoto,
        content: mockContent,
        evaluate: mockEvaluate,
        on: vi.fn(),
        mainFrame: vi.fn(),
      }),
      close: mockClose,
    }));
    const mockGetBrowser = vi.fn().mockResolvedValue({
      newContext: mockNewContext,
    });

    return {
      mockAddCookies,
      mockEvaluate,
      mockGoto,
      mockNewContext,
      mockGetBrowser,
    };
  }
);

vi.mock("@norish/api/obscura", () => ({
  getBrowser: mockGetBrowser,
}));

vi.mock("@norish/shared-server/logger", () => ({
  parserLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(
  overrides: Partial<SiteAuthTokenDecryptedDto> & {
    name: string;
    value: string;
    type: "header" | "cookie";
  }
): SiteAuthTokenDecryptedDto {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    userId: "user-1",
    domain: "example.com",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

/** Extract the `extraHTTPHeaders` passed to `browser.newContext()`. */
function getExtraHTTPHeaders(): Record<string, string> | undefined {
  const arg = mockNewContext.mock.calls[0]?.[0] as
    { extraHTTPHeaders?: Record<string, string> } | undefined;

  return arg?.extraHTTPHeaders;
}

/** The cookies set from the page, as `{ name, value }`, and the URLs visited in order. */
function setFromPage(): { cookies: unknown; visited: string[] } {
  return {
    cookies: mockEvaluate.mock.calls[0]?.[1],
    visited: mockGoto.mock.calls.map((call) => call[0] as string),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => vi.clearAllMocks());

describe("fetchRenderedPage – auth token injection", () => {
  it("sends no headers at all when no tokens are provided", async () => {
    await fetchRenderedPage("https://example.com/recipe");

    // Obscura owns the browser identity, so a fetch with nothing to inject
    // customises nothing.
    expect(getExtraHTTPHeaders()).toBeUndefined();

    expect(setFromPage()).toEqual({ cookies: undefined, visited: ["https://example.com/recipe"] });
  });

  it("sends no headers at all when tokens is undefined", async () => {
    await fetchRenderedPage("https://example.com/recipe", undefined);

    expect(getExtraHTTPHeaders()).toBeUndefined();

    expect(setFromPage()).toEqual({ cookies: undefined, visited: ["https://example.com/recipe"] });
  });

  it("passes header tokens through as extraHTTPHeaders, exactly as configured", async () => {
    const tokens = [
      makeToken({ name: "Authorization", value: "Bearer abc123", type: "header" }),
      makeToken({ name: "X-Custom", value: "custom-val", type: "header" }),
    ];

    await fetchRenderedPage("https://example.com/recipe", tokens);

    const headers = getExtraHTTPHeaders()!;

    expect(headers["Authorization"]).toBe("Bearer abc123");
    expect(headers["X-Custom"]).toBe("custom-val");

    // The user's tokens are the only thing Norish sends.
    expect(Object.keys(headers)).toHaveLength(2);

    // No cookies to set
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("sets cookie tokens from the target's own origin, whose jar sends them to that host only", async () => {
    const tokens = [makeToken({ name: "session_id", value: "sess-abc", type: "cookie" })];

    await fetchRenderedPage("https://recipes.example.com/page", tokens);

    // Obscura drops cookies set over CDP, so none go through addCookies.
    expect(mockAddCookies).not.toHaveBeenCalled();
    expect(setFromPage()).toEqual({
      cookies: [{ name: "session_id", value: "sess-abc" }],
      visited: ["https://recipes.example.com/robots.txt", "https://recipes.example.com/page"],
    });

    // Cookie tokens never leak into the header set
    expect(getExtraHTTPHeaders()).toBeUndefined();
  });

  it("handles mixed header and cookie tokens", async () => {
    const tokens = [
      makeToken({ name: "Authorization", value: "Bearer xyz", type: "header" }),
      makeToken({ name: "session", value: "sess-123", type: "cookie" }),
      makeToken({ name: "X-Api-Key", value: "key-456", type: "header" }),
      makeToken({ name: "prefs", value: "dark-mode", type: "cookie" }),
    ];

    await fetchRenderedPage("https://food.example.org/r/1", tokens);

    // Verify header tokens merged
    const headers = getExtraHTTPHeaders()!;

    expect(headers["Authorization"]).toBe("Bearer xyz");
    expect(headers["X-Api-Key"]).toBe("key-456");

    expect(setFromPage().cookies).toEqual([
      { name: "session", value: "sess-123" },
      { name: "prefs", value: "dark-mode" },
    ]);
  });

  it("adds multiple cookie tokens for the same domain", async () => {
    const tokens = [
      makeToken({ name: "token_a", value: "val-a", type: "cookie" }),
      makeToken({ name: "token_b", value: "val-b", type: "cookie" }),
      makeToken({ name: "token_c", value: "val-c", type: "cookie" }),
    ];

    await fetchRenderedPage("https://example.com/page", tokens);

    expect(mockEvaluate).toHaveBeenCalledOnce();
    expect(setFromPage().cookies).toEqual([
      { name: "token_a", value: "val-a" },
      { name: "token_b", value: "val-b" },
      { name: "token_c", value: "val-c" },
    ]);
  });
});
