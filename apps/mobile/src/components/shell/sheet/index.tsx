import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, useThemeColor } from 'heroui-native';
import React from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type PresentationDetent = 'medium' | 'large';

export interface ShellSheetProps {
  /** Whether the sheet is currently presented. */
  isPresented: boolean;
  /** Called when the presented state changes (e.g. user swipes to dismiss). */
  onIsPresentedChange: (isPresented: boolean) => void;
  /** Allowed sheet heights. Defaults to medium + large. */
  detents?: PresentationDetent[];
  /** Height used whenever the sheet is newly presented. */
  initialDetent?: PresentationDetent;
  children: React.ReactNode;
}

/**
 * Base wrapper for SwiftUI BottomSheets that contain React Native content.
 *
 * Uses iOS medium + large detents instead of fit-to-contents sizing.
 * This is more stable for RN-driven content and avoids occasional near-zero
 * measured heights when Yoga and SwiftUI layout timing disagree.
 *
 * A primary close button is rendered in the top-right corner of every sheet.
 */
export function ShellSheet({
  isPresented,
  onIsPresentedChange,
  detents = ['medium', 'large'],
  initialDetent = 'medium',
  children,
}: ShellSheetProps) {
  const [sheetBackgroundColor] = useThemeColor(['surface'] as const);
  const insets = useSafeAreaInsets();
  const [selectedDetent, setSelectedDetent] = React.useState<PresentationDetent>(initialDetent);

  React.useEffect(() => {
    if (isPresented) {
      setSelectedDetent(initialDetent);
    }
  }, [initialDetent, isPresented]);

  if (Platform.OS === 'ios') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const swiftUI = require('@expo/ui/swift-ui') as {
        BottomSheet: React.ComponentType<any>;
        Group: React.ComponentType<any>;
        Host: React.ComponentType<any>;
        RNHostView: React.ComponentType<any>;
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const modifiers = require('@expo/ui/swift-ui/modifiers') as {
        presentationDetents: (detents: PresentationDetent[], options: {
          selection: PresentationDetent;
          onSelectionChange: (value: PresentationDetent) => void;
        }) => unknown;
        presentationDragIndicator: (value: 'visible' | 'hidden') => unknown;
      };

      const { BottomSheet, Group, Host, RNHostView } = swiftUI;
      const { presentationDetents, presentationDragIndicator } = modifiers;

      return (
        <Host matchContents>
          <BottomSheet
            isPresented={isPresented}
            onIsPresentedChange={onIsPresentedChange}
          >
            <Group
              modifiers={[
                presentationDetents(detents, {
                  selection: selectedDetent,
                  onSelectionChange: setSelectedDetent,
                }),
                presentationDragIndicator('visible'),
              ]}
            >
              <RNHostView>
                <View collapsable={false} style={styles.contentRoot}>
                  <View style={styles.closeRow}>
                    <Button
                      isIconOnly
                      variant="primary"
                      size="md"
                      onPress={() => onIsPresentedChange(false)}
                      className="rounded-full"
                    >
                      <Ionicons name="close" size={18} color="#ffffff" />
                    </Button>
                  </View>
                  {children}
                </View>
              </RNHostView>
            </Group>
          </BottomSheet>
        </Host>
      );
    } catch {
      // Fall through to the Android-style modal fallback.
    }
  }

  return (
    <Modal
      visible={isPresented}
      animationType="slide"
      transparent
      onRequestClose={() => onIsPresentedChange(false)}
    >
      <Pressable style={styles.androidBackdrop} onPress={() => onIsPresentedChange(false)}>
        <Pressable
          style={[
            styles.androidSheet,
            {
              backgroundColor: sheetBackgroundColor,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={() => undefined}
        >
          <View style={styles.closeRow}>
            <Button
              isIconOnly
              variant="primary"
              size="md"
              onPress={() => onIsPresentedChange(false)}
              className="rounded-full"
            >
              <Ionicons name="close" size={18} color="#ffffff" />
            </Button>
          </View>
          <View style={styles.contentRoot}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  contentRoot: {
    flex: 1,
    alignSelf: 'stretch',
  },
  closeRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    alignItems: 'flex-end',
  },
  androidBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  androidSheet: {
    minHeight: '55%',
    maxHeight: '92%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
});
