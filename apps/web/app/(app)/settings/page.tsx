import { readRequestProfile } from "@/lib/request-profile";

import SettingsPageContent from "./components/settings-page-content";

export default async function SettingsPage() {
  // The layout's own session read: hiding the tab is presentation only, since
  // every admin procedure authorises server-side.
  const { identity } = await readRequestProfile();

  return <SettingsPageContent showAdminTab={identity?.isServerAdmin ?? false} />;
}
