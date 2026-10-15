"use client";

import { SettingsTabs } from "@/app/(app)/settings/components/settings-tabs";
import { SettingsTabSkeleton } from "@/components/skeleton/settings-skeleton";

/**
 * The settings page while its route loads: the real title and tab bar, and the
 * open tab's {@link SettingsTabSkeleton}, which every later wait draws too.
 */
export default function SettingsPageSkeleton({ showAdminTab }: { showAdminTab: boolean }) {
  return (
    <SettingsTabs panel={(tab) => <SettingsTabSkeleton tab={tab} />} showAdminTab={showAdminTab} />
  );
}
