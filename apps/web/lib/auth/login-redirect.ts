/**
 * The header the proxy forwards a request's path and query in, so a page
 * that finds no session can send the reader to sign in and back again.
 */
export const DESTINATION_HEADER = "x-norish-destination";

/** The login page, returning to `destination` once the reader has signed in. */
export function loginPath(destination: string | null): string {
  return `/login?${new URLSearchParams({ callbackUrl: destination ?? "/" })}`;
}
