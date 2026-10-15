import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/app/(app)/app-shell";
import { DESTINATION_HEADER, loginPath } from "@/lib/auth/login-redirect";
import { readDevicePreferencesSeed, readRequestProfile } from "@/lib/request-profile";

/**
 * The page gate of the signed-in app. The proxy only checks that a session
 * cookie is present; here the session is read and its account verified, once
 * per request, and a reader without one is sent to sign in and back.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await readRequestProfile()).userId) {
    redirect(loginPath((await headers()).get(DESTINATION_HEADER)));
  }

  // The reader's Device Preferences for this request's Device Kind, read
  // once, so the shell seeds the very first render. The offline bootstrap
  // mounts the same shell unseeded and reads the restored profile instead.
  return <AppShell devicePreferences={await readDevicePreferencesSeed()}>{children}</AppShell>;
}
