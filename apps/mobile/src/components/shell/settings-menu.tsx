import { useRouter } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import React, { useSyncExternalStore } from 'react';
import { useIntl } from 'react-intl';

import { type AppearanceMode, useAppearancePreference } from '@/context/appearance-preference-context';
import { useMobileLocaleSettings } from '@/context/mobile-i18n-context';
import { getLocaleSnapshot, subscribeLocaleStore } from '@/lib/i18n/locale-store';
import { ShellMenu, ShellMenuItem, ShellMenuPicker } from '@/components/shell/menu';

/**
 * Native iOS settings menu for the Recipes tab header.
 */
export function SettingsMenu() {
  const router = useRouter();
  const intl = useIntl();
  const [mutedColor] = useThemeColor(['muted'] as const);
  const { mode, setMode } = useAppearancePreference();
  const { enabledLocales, localeNames, isLoading, setLocale } = useMobileLocaleSettings();

  // Read locale from the synchronous store so this component re-renders on
  // the same tick that setLocale() is called, not after the async React state
  // chain settles.
  const { locale } = useSyncExternalStore(subscribeLocaleStore, getLocaleSnapshot, getLocaleSnapshot);

  return (
    <ShellMenu
      label={intl.formatMessage({ id: 'navbar.userMenu.settings.title' })}
      systemImage="gearshape"
      color={mutedColor}
    >
      <ShellMenuPicker
        label={intl.formatMessage({ id: 'navbar.theme.title' })}
        systemImage="circle.lefthalf.filled"
        selection={mode}
        onSelectionChange={(value) => setMode(value as AppearanceMode)}
        options={[
          { value: 'system', label: intl.formatMessage({ id: 'navbar.theme.system' }) },
          { value: 'light', label: intl.formatMessage({ id: 'navbar.theme.light' }) },
          { value: 'dark', label: intl.formatMessage({ id: 'navbar.theme.dark' }) },
        ]}
      />

      {!isLoading && enabledLocales.length > 1 && (
        <ShellMenuPicker
          label={localeNames[locale] ?? locale}
          systemImage="globe"
          selection={locale}
          onSelectionChange={(value) => setLocale(value as string)}
          options={enabledLocales.map((l) => ({
            value: l.code,
            label: localeNames[l.code] ?? l.code,
          }))}
        />
      )}

      <ShellMenuItem
        label={intl.formatMessage({ id: 'settings.user.profile.title' })}
        systemImage="person.crop.circle"
        onPress={() => router.push('/(tabs)/profile')}
      />
    </ShellMenu>
  );
}
