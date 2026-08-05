import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { AppHeader } from './ui';

/**
 * A full screen with a back button, a scrolling body and an optional pinned
 * action — the counterpart to `BottomSheet` for content that is a PLACE rather
 * than a task.
 *
 * The distinction matters for navigation: a sheet is something you finish and
 * dismiss, so it closes with an ✕ and returns you to where you were. A screen
 * is somewhere you go, may drill further into, and come back from — which wants
 * a back chevron and a title bar that stays put.
 *
 * The add-on features are the latter. A fuel log is browsed, drilled into
 * (vehicles, services, individual fill-ups) and returned from, and presenting
 * that as a stack of modal sheets made every level feel like an interruption of
 * the one beneath it.
 */
export function Screen({
  title,
  onBack,
  action,
  footer,
  children,
}: {
  title: string;
  onBack?: () => void;
  /** Optional icon button on the right of the header. */
  action?: {
    icon: React.ComponentProps<typeof AppHeader>['action'] extends { icon: infer I } ? I : never;
    onPress: () => void;
    label: string;
  };
  /** Pinned to the bottom, above the safe area — usually a GradientButton. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AppHeader title={title} onBack={onBack} action={action} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.lg,
          // Room for the pinned footer, so the last card is never trapped
          // underneath it.
          paddingBottom: footer ? space.lg + 72 : space.lg + insets.bottom,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>

      {footer ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: insets.bottom + space.sm,
            backgroundColor: colors.canvas,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
