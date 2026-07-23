import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
// SDK 56+ forbids importing from `@react-navigation/*` in app code. expo-router
// vendors those types; this is the path they are declared at.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

/**
 * Floating dock.
 *
 * Fully detached from the screen edges on all four sides — the canvas shows
 * all the way round it, so it reads as an object above the content rather than
 * a fixed chrome strip. Every slot (the tabs and the trailing add action) is a
 * fixed 48px square laid out in one evenly-spaced row, so the icons sit on a
 * single baseline and nothing is pushed off-centre. The active tab is a soft
 * accent-tinted square behind its icon+label; the add action is the one filled
 * gradient square, marking it as the primary action without breaking the row's
 * rhythm.
 */

const DOCK_HEIGHT = 64;
const SIDE_INSET = 16;
const SLOT = 48;

const ICONS: Record<string, { active: string; inactive: string; label: string }> = {
  index: { active: 'grid', inactive: 'grid-outline', label: 'Dashboard' },
  list: { active: 'list', inactive: 'list-outline', label: 'List' },
  loans: { active: 'pie-chart', inactive: 'pie-chart-outline', label: 'Loans' },
  settings: { active: 'settings', inactive: 'settings-outline', label: 'Settings' },
};

/**
 * Vertical space a tab screen must leave at the end of its scroll content so
 * the last row clears the dock. A hook (not a constant) because it depends on
 * the device's real safe-area inset.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return DOCK_HEIGHT + Math.max(insets.bottom, 12) + 28;
}

export function TabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const { colors, radius, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // A custom tab bar must honour `href: null` itself — unlike the default bar,
  // it won't skip hidden routes for us. expo-router consumes `href` before the
  // tab bar sees the options, converting `href: null` into
  // `tabBarItemStyle: { display: 'none' }` (see expo-router TabsClient), so
  // that display flag — not `href` — is the reliable "hidden" signal.
  const routes = state.routes.filter((route) => {
    const itemStyle = StyleSheet.flatten(
      descriptors[route.key]?.options?.tabBarItemStyle,
    ) as { display?: string } | undefined;
    return itemStyle?.display !== 'none';
  });

  return (
    <View
      style={{
        position: 'absolute',
        left: SIDE_INSET,
        right: SIDE_INSET,
        bottom: Math.max(insets.bottom, 16),
      }}
      pointerEvents="box-none"
    >
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            height: DOCK_HEIGHT,
            borderRadius: radius.pill,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            paddingHorizontal: 8,
          },
          shadow.lifted,
        ]}
      >
        {/* Tabs share the leading space equally; the add slot is fixed-width
            and trails, so the four labels stay perfectly even regardless of
            screen width. */}
        {routes.map((route) => {
          // Compare by key, not by position — filtering out hidden routes
          // shifts array indices out of step with `state.index`.
          const focused = state.routes[state.index]?.key === route.key;
          const meta = ICONS[route.name] ?? {
            active: 'ellipse',
            inactive: 'ellipse-outline',
            label: route.name,
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              hitSlop={4}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  height: SLOT,
                  minWidth: SLOT,
                  paddingHorizontal: 6,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  backgroundColor: focused ? colors.accentSoft : 'transparent',
                }}
              >
                <Ionicons
                  name={(focused ? meta.active : meta.inactive) as never}
                  size={20}
                  color={focused ? colors.accent : colors.inkMuted}
                />
                <T
                  color={focused ? colors.accent : colors.inkMuted}
                  numberOfLines={1}
                  style={{
                    fontSize: 10,
                    lineHeight: 11,
                    fontWeight: focused ? '700' : '500',
                    includeFontPadding: Platform.OS === 'android' ? false : undefined,
                  }}
                >
                  {meta.label}
                </T>
              </View>
            </Pressable>
          );
        })}

        {/* Slim divider sets the add action apart without a hard break. */}
        <View
          style={{
            width: 1,
            height: 26,
            backgroundColor: colors.hairline,
            marginHorizontal: 6,
          }}
        />

        {/*
          Add action — a fixed 48px gradient square, the one filled slot, so it
          reads as the primary action. Opens the transaction screen (the model
          has no free-form entry): pick a category and log it.
        */}
        <Pressable
          onPress={() => router.push('/transaction/new')}
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          hitSlop={6}
          style={({ pressed }) => ({
            width: SLOT,
            height: SLOT,
            borderRadius: radius.md,
            overflow: 'hidden',
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <LinearGradient
            colors={[colors.gradientStart, colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}
