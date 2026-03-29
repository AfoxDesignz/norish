import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColor } from 'heroui-native';
import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export interface ShellMenuProps {
  /** Text label for the menu trigger button. */
  label: string;
  /** SF Symbol name displayed as the trigger icon. */
  systemImage?: string;
  /** Color applied to the trigger icon via foregroundStyle modifier. */
  color?: string;
  /** Menu items — use `@expo/ui/swift-ui` Button, Picker, Divider, etc. */
  children: React.ReactNode;
}

export interface ShellMenuItemProps {
  label: string;
  onPress: () => void;
  systemImage?: string;
  isDisabled?: boolean;
}

export interface ShellMenuDividerProps {
  /** Optional separator top spacing for denser groups. */
  compact?: boolean;
}

export interface ShellMenuPickerOption {
  value: string;
  label: string;
}

export interface ShellMenuPickerProps {
  label: string;
  selection: string;
  onSelectionChange: (value: string) => void;
  options: ShellMenuPickerOption[];
  systemImage?: string;
}

const MenuCloseContext = React.createContext<() => void>(() => undefined);

function resolveTriggerIcon(systemImage?: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (!systemImage) return 'ellipsis-horizontal';
  if (systemImage.includes('gear')) return 'settings-outline';
  if (systemImage.includes('ellipsis')) return 'ellipsis-horizontal';
  if (systemImage.includes('person')) return 'person-outline';
  if (systemImage.includes('globe')) return 'language-outline';
  return 'ellipsis-horizontal';
}

function resolveRowIcon(systemImage?: string): React.ComponentProps<typeof Ionicons>['name'] | null {
  if (!systemImage) return null;
  if (systemImage === 'checkmark') return 'checkmark';
  if (systemImage.includes('trash')) return 'trash-outline';
  if (systemImage.includes('pencil')) return 'create-outline';
  if (systemImage.includes('sparkles')) return 'sparkles-outline';
  if (systemImage.includes('person')) return 'person-outline';
  if (systemImage.includes('globe')) return 'language-outline';
  if (systemImage.includes('calendar')) return 'calendar-outline';
  if (systemImage.includes('cart')) return 'cart-outline';
  if (systemImage.includes('arrow')) return 'swap-horizontal';
  return 'chevron-forward';
}

function getIOSMenuBindings() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const swiftUI = require('@expo/ui/swift-ui') as {
      Host: React.ComponentType<any>;
      Menu: React.ComponentType<any>;
      Button: React.ComponentType<any>;
      Divider: React.ComponentType<any>;
      Picker: React.ComponentType<any>;
      Text: React.ComponentType<any>;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modifiers = require('@expo/ui/swift-ui/modifiers') as {
      buttonStyle: (value: string) => unknown;
      foregroundStyle: (value: string) => unknown;
      labelStyle: (value: string) => unknown;
      pickerStyle: (value: string) => unknown;
      tag: (value: string) => unknown;
    };
    return { swiftUI, modifiers };
  } catch {
    return null;
  }
}

export function ShellMenu({ label, systemImage, color, children }: ShellMenuProps) {
  const [foregroundColor] = useThemeColor(['foreground'] as const);
  const [surfaceColor, separatorColor] = useThemeColor(['surface', 'separator'] as const);
  const [isOpen, setIsOpen] = React.useState(false);

  const iosBindings = Platform.OS === 'ios' ? getIOSMenuBindings() : null;

  if (iosBindings) {
    const { Host, Menu } = iosBindings.swiftUI;
    const { buttonStyle, foregroundStyle, labelStyle } = iosBindings.modifiers;
    return (
      <Host matchContents style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Menu
          label={label}
          systemImage={systemImage}
          modifiers={[
            ...(color ? [foregroundStyle(color)] : []),
            labelStyle('iconOnly'),
            buttonStyle('plain'),
          ]}
        >
          {children}
        </Menu>
      </Host>
    );
  }

  const triggerColor = color ?? foregroundColor;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setIsOpen(true)}
        style={styles.trigger}
      >
        <Ionicons name={resolveTriggerIcon(systemImage)} size={20} color={triggerColor} />
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={isOpen}
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setIsOpen(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: surfaceColor, borderColor: separatorColor }]}
            onPress={() => undefined}
          >
            <Text style={[styles.modalTitle, { color: foregroundColor }]}>{label}</Text>
            <MenuCloseContext.Provider value={() => setIsOpen(false)}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
                {children}
              </ScrollView>
            </MenuCloseContext.Provider>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function ShellMenuItem({ label, onPress, systemImage, isDisabled = false }: ShellMenuItemProps) {
  const [foregroundColor, mutedColor, accentColor, dangerColor] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'danger',
  ] as const);
  const closeMenu = React.useContext(MenuCloseContext);
  const iosBindings = Platform.OS === 'ios' ? getIOSMenuBindings() : null;

  if (iosBindings) {
    const { Button } = iosBindings.swiftUI;
    return (
      <Button
        label={label}
        systemImage={systemImage}
        disabled={isDisabled}
        onPress={onPress}
      />
    );
  }

  const rowIcon = resolveRowIcon(systemImage);
  const isDestructive = Boolean(systemImage?.includes('trash'));
  const rowColor = isDisabled ? mutedColor : isDestructive ? dangerColor : foregroundColor;
  const iconColor = isDestructive ? dangerColor : accentColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={() => {
        onPress();
        closeMenu();
      }}
      style={styles.row}
    >
      <Text style={[styles.rowText, { color: rowColor }]}>{label}</Text>
      {rowIcon ? <Ionicons name={rowIcon} size={16} color={iconColor} /> : null}
    </Pressable>
  );
}

export function ShellMenuDivider({ compact = false }: ShellMenuDividerProps) {
  const [separatorColor] = useThemeColor(['separator'] as const);
  const iosBindings = Platform.OS === 'ios' ? getIOSMenuBindings() : null;

  if (iosBindings) {
    const { Divider } = iosBindings.swiftUI;
    return <Divider />;
  }

  return <View style={[styles.divider, { marginTop: compact ? 6 : 12, borderColor: separatorColor }]} />;
}

export function ShellMenuPicker({
  label,
  selection,
  onSelectionChange,
  options,
  systemImage,
}: ShellMenuPickerProps) {
  const [foregroundColor, mutedColor, accentColor] = useThemeColor(['foreground', 'muted', 'accent'] as const);
  const closeMenu = React.useContext(MenuCloseContext);
  const iosBindings = Platform.OS === 'ios' ? getIOSMenuBindings() : null;

  if (iosBindings) {
    const { Picker, Text: UIText } = iosBindings.swiftUI;
    const { pickerStyle, tag } = iosBindings.modifiers;
    return (
      <Picker
        key={selection}
        label={label}
        systemImage={systemImage}
        selection={selection}
        onSelectionChange={(value: string) => onSelectionChange(value)}
        modifiers={[pickerStyle('menu')]}
      >
        {options.map((option) => (
          <UIText key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </UIText>
        ))}
      </Picker>
    );
  }

  return (
    <View style={styles.pickerBlock}>
      <Text style={[styles.pickerLabel, { color: mutedColor }]}>{label}</Text>
      {options.map((option) => {
        const isSelected = option.value === selection;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            onPress={() => {
              onSelectionChange(option.value);
              closeMenu();
            }}
            style={styles.row}
          >
            <Text style={[styles.rowText, { color: foregroundColor }]}>{option.label}</Text>
            {isSelected ? <Ionicons name="checkmark" size={18} color={accentColor} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    maxHeight: '75%',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  modalContent: {
    paddingBottom: 10,
  },
  row: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: {
    fontSize: 15,
    fontWeight: '500',
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  pickerBlock: {
    marginTop: 6,
  },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
