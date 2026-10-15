"use client";

import type { SettingsTab } from "@/app/(app)/settings/components/settings-tabs";
import type { ComponentType, SVGProps } from "react";
import { SettingsCard } from "@/app/(app)/settings/components/settings-card";
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BookOpenIcon,
  CircleStackIcon,
  Cog6ToothIcon,
  DocumentMagnifyingGlassIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  LinkIcon,
  QueueListIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { Skeleton } from "@heroui/react";
import { useTranslations } from "next-intl";

type CardPlaceholder = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** The card's messages under `settings`; absent where its title depends on the reader's data. */
  section?: string;
  description?: boolean;
  danger?: boolean;
  rows: number;
};

/**
 * The cards every reader's tab has, in its order. Household has none: with a
 * household and without one, the tab shows different cards.
 */
const TAB_CARDS: Record<SettingsTab, CardPlaceholder[]> = {
  user: [
    { icon: UserCircleIcon, section: "user.profile", rows: 2 },
    { icon: AdjustmentsHorizontalIcon, section: "user.preferences", description: true, rows: 6 },
    { icon: ExclamationTriangleIcon, section: "user.allergies", description: true, rows: 1 },
    { icon: KeyIcon, section: "user.apiKeys", description: true, rows: 1 },
    { icon: LinkIcon, section: "user.shareLinks", description: true, rows: 1 },
    { icon: ShieldCheckIcon, section: "user.siteAuthTokens", description: true, rows: 1 },
    { icon: ArrowUpTrayIcon, section: "user.archiveImport", description: true, rows: 1 },
    { icon: ArrowDownTrayIcon, section: "user.archiveExport", description: true, rows: 1 },
    {
      icon: ExclamationCircleIcon,
      section: "user.dangerZone",
      description: true,
      danger: true,
      rows: 1,
    },
  ],
  household: [],
  // Set up or configured: the card's title says which.
  caldav: [{ icon: ServerIcon, rows: 3 }],
  ingredients: [
    { icon: BookOpenIcon, section: "ingredients", description: true, rows: 6 },
    { icon: CircleStackIcon, section: "ingredients.dataSources", rows: 2 },
  ],
  admin: [
    { icon: Cog6ToothIcon, section: "admin.general", rows: 4 },
    { icon: UsersIcon, section: "admin.users", description: true, rows: 2 },
    { icon: ShieldCheckIcon, section: "admin.permissions", description: true, rows: 4 },
    { icon: LinkIcon, section: "admin.shareLinks", description: true, rows: 1 },
    { icon: KeyIcon, section: "admin.authProviders", description: true, rows: 3 },
    {
      icon: DocumentMagnifyingGlassIcon,
      section: "admin.contentDetection",
      description: true,
      rows: 2,
    },
    { icon: SparklesIcon, section: "admin.aiProcessing", description: true, rows: 3 },
    { icon: QueueListIcon, section: "admin.jobQueue", rows: 3 },
    { icon: WrenchScrewdriverIcon, section: "admin.system", rows: 2 },
  ],
};

/**
 * A settings tab while it loads: its cards' real headers over grey rows. The route, the
 * tab's lazy load and its data wait all draw it.
 */
export function SettingsTabSkeleton({ tab }: { tab: SettingsTab }) {
  const t = useTranslations("settings");

  return (
    <div className="flex w-full flex-col gap-6">
      {TAB_CARDS[tab].map(({ icon, section, description, danger, rows }, index) => (
        <SettingsCard
          key={section ?? index}
          danger={danger}
          description={section && description ? t(`${section}.description`) : undefined}
          icon={icon}
          title={section ? t(`${section}.title`) : <Skeleton className="h-6 w-48 rounded-lg" />}
        >
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className="h-12 w-full rounded-lg" />
          ))}
        </SettingsCard>
      ))}
    </div>
  );
}
