import SettingsPageSkeleton from "@/components/skeleton/settings-page-skeleton";
import { readRequestProfile } from "@/lib/request-profile";

export default async function Loading() {
  // The layout has read the profile already; this is the same cached read.
  const { identity } = await readRequestProfile();

  return <SettingsPageSkeleton showAdminTab={identity?.isServerAdmin ?? false} />;
}
