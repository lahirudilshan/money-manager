import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
// SDK 56+ forbids importing from `@react-navigation/*` in app code. expo-router
// vendors those types; this is the path they are declared at.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

/**
 * Floating dock.
 *
 * Fully detached from the screen edges on all four sides — unlike a docked
 * bar, the canvas shows all the way round it, so it reads as an object
 * sitting above the content rather than a fixed chrome strip. The active
 * route is a pill that slides beneath the icon+label rather than a static
 * tint, so switching tabs is felt as motion, not just a colour swap. The add
 * action lives inside the dock as a small trailing icon button instead of a
 * large button breaking the bar's silhouette.
 */

const DOCK_HEIGHT = 60;
const SIDE_INSET = 16;
const ADD_BUTTON_SIZE = 40;

const ICONS: Record<string, { active: string; inactive: string; label: string }> = {
  index: { active: 'grid', inactive: 'grid-outline', label: 'Board' },
  summary: { active: 'reader', inactive: 'reader-outline', label: 'Summary' },
  cards: { active: 'wallet', inactive: 'wallet-outline', label: 'Cards' },
  income: { active: 'trending-up', inactive: 'trending-up-outline', label: 'Income' },
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

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors, radius, shadow, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const routes = state.routes;

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
            paddingHorizontal: 6,
            gap: 6,
          },
          shadow.lifted,
        ]}
      >
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {routes.map((route, index) => {
            const focused = state.index === index;
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
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                {/* Active tab: icon sits inside a filled accent circle. */}
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: focused ? colors.accent : 'transparent',
                  }}
                >
                  <Ionicons
                    name={(focused ? meta.active : meta.inactive) as never}
                    size={19}
                    color={focused ? colors.inkInverse : colors.inkMuted}
                  />
                </View>
                <T
                  variant="caption"
                  color={focused ? colors.accent : colors.inkMuted}
                  style={{
                    fontSize: 9.5,
                    fontWeight: focused ? '700' : '500',
                    includeFontPadding: Platform.OS === 'android' ? false : undefined,
                  }}
                >
                  {meta.label}
                </T>
              </Pressable>
            );
          })}
        </View>

        {/*
          Add action lives inside the dock rather than floating above it —
          the model has no free-form entry, so this opens the transaction
          screen: pick a predefined category (or create one) and log it.
        */}
        <Pressable
          onPress={() => router.push('/transaction/new')}
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          style={({ pressed }) => ({
            width: ADD_BUTTON_SIZE,
            height: ADD_BUTTON_SIZE,
            borderRadius: ADD_BUTTON_SIZE / 2,
            marginRight: 2,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <LinearGradient
            colors={[colors.gradientStart, colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: ADD_BUTTON_SIZE / 2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}
