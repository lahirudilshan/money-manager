import { Ionicons } from '@expo/vector-icons';
import { isAiEnabled } from '~/features/health/services/aiSettings';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
// SDK 56+ forbids importing from `@react-navigation/*` in app code. expo-router
// vendors those types; this is the path they are declared at.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Blur, canBlur } from './Blur';
import { Text } from './ui';

/**
 * Floating dock.
 *
 * Fully detached from the screen edges on all four sides — the canvas shows
 * all the way round it, so it reads as an object above the content rather than
 * a fixed chrome strip. Every slot is one SLOT tall, so the icons sit on a
 * single baseline, and each tab is as wide as its own label needs — an equal
 * quarter each meant the longest label truncated while the shortest sat in
 * empty space.
 *
 * No tab carries a background — the dock is the only surface, and boxing the
 * tabs inside it turned the row into slabs competing with the bar that holds
 * them. Selection is colour and glyph: accent vs. muted, filled vs. outlined —
 * never anything that changes a tab's size, since the tabs are content-width
 * and any one of them growing re-flows the whole row. The add action is the one
 * filled shape, a gradient circle, which is what marks it as the primary
 * action.
 */

/*
 * One coherent set of dimensions, derived from the slot rather than tuned
 * independently — the previous values had drifted into contradicting each other.
 *
 * The slot is the unit: a 44pt square is the platform's minimum touch target, so
 * every tab is at least that, and the dock is a slot plus even padding above and
 * below. Horizontal padding matches the vertical, so the row sits the same
 * distance from every edge of the bar.
 */
const SLOT = 44;
/**
 * Breathing room between a slot and the dock's rim, on all four sides.
 *
 * The tabs carry no background of their own, so this gap is the only thing
 * separating the glyphs from the bar's edge — it has to do the work a tint
 * behind them used to.
 */
const DOCK_PADDING = 14;
const DOCK_HEIGHT = SLOT + DOCK_PADDING * 2;

/**
 * Gap between the dock and the screen's edges — the same on the left, right and
 * bottom, so the bar sits in an even frame of canvas rather than floating higher
 * than it is wide.
 *
 * This and DOCK_PADDING both come out of the same width, and the four labels
 * ("Dashboard" is the binding one) need what is left: the tabs are sized to
 * their content, so when the row runs out of room it overflows the bar rather
 * than clipping.
 */
const EDGE_INSET = 16;

const ICONS: Record<string, { active: string; inactive: string; label: string }> = {
  index: { active: 'grid', inactive: 'grid-outline', label: 'Dashboard' },
  list: { active: 'list', inactive: 'list-outline', label: 'List' },
  loans: { active: 'pie-chart', inactive: 'pie-chart-outline', label: 'Loans' },
  settings: {
    active: 'settings',
    inactive: 'settings-outline',
    label: 'Settings',
  },
};

/**
 * How far the dock floats above the screen's bottom edge. Used by the dock's own
 * `bottom` and by the scroll clearance below, so the two can never disagree.
 */
function dockBottomOffset(safeAreaBottom: number): number {
  // The same inset as the sides, so the frame of canvas around the dock is even.
  // A device with a home indicator reserves ~34pt at the bottom, which already
  // exceeds that — take whichever is larger rather than adding them, or the gap
  // below ends up two and a half times the gap at the sides.
  return Math.max(safeAreaBottom, EDGE_INSET);
}

/**
 * Vertical space a tab screen must leave at the end of its scroll content so
 * the last row clears the dock. A hook (not a constant) because it depends on
 * the device's real safe-area inset.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  // The dock's own offset, plus its height, plus a gap so the last row does not
  // sit against it.
  return DOCK_HEIGHT + dockBottomOffset(insets.bottom) + 28;
}

export function TabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const { colors, radius, shadow, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const dark = mode === 'dark';
  const blur = canBlur();
  const bottom = dockBottomOffset(insets.bottom);
  // The dock's top edge, measured from the screen's bottom.
  const dockTop = bottom + DOCK_HEIGHT;
  // The tallest blur strip covers the whole dock and reaches a few points past
  // its top, so nothing sharp shows between the dock and the blur.
  const blurTop = dockTop + 8;
  // The shade reaches a little above the blur so content eases out of view
  // rather than meeting the blur's hard top line.
  const fadeHeight = blurTop + 16;
  const blurStrips = [blurTop, dockTop * 0.75, dockTop * 0.5];
  const [menuOpen, setMenuOpen] = useState(false);

  // A custom tab bar must honour `href: null` itself — unlike the default bar,
  // it won't skip hidden routes for us. expo-router consumes `href` before the
  // tab bar sees the options, converting `href: null` into
  // `tabBarItemStyle: { display: 'none' }` (see expo-router TabsClient), so
  // that display flag — not `href` — is the reliable "hidden" signal.
  const routes = state.routes.filter((route) => {
    const itemStyle = StyleSheet.flatten(descriptors[route.key]?.options?.tabBarItemStyle) as
      { display?: string } | undefined;
    return itemStyle?.display !== 'none';
  });

  return (
    <>
      {/*
      The backdrop around the dock: content scrolling under it is blurred and
      faded into the canvas, so the dock never sits on top of sharp text.

      The tallest blur strip covers the whole dock plus a few points above it;
      the two shorter ones stack extra blur toward the bottom. The band above
      the blur is shade only — the canvas gradient, eased from clear — so the
      backdrop's top edge fades in rather than starting at a line. Touches pass
      straight through.
    */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: fadeHeight,
        }}
      >
        {blur
          ? blurStrips.map((height, i) => (
              <Blur
                key={i}
                intensity={[10, 14, 18][i]}
                dark={dark}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height,
                }}
              />
            ))
          : null}
        <LinearGradient
          colors={[
            colors.canvas + '00',
            colors.canvas + (blur ? '66' : '99'),
            colors.canvas + (blur ? 'B3' : 'E6'),
            colors.canvas + (blur ? 'D9' : 'F2'),
          ]}
          locations={[0, 0.2, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          left: EDGE_INSET,
          right: EDGE_INSET,
          bottom,
        }}
        pointerEvents="box-none"
      >
        <View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              // Tabs are content-width, so the leftover width is shared between
              // them rather than absorbed into four equal columns.
              justifyContent: 'space-between',
              // A floor on the gap between slots. `space-between` alone would let
              // it collapse to nothing on a narrow screen, since it only
              // distributes whatever is left over — this guarantees the tabs never
              // touch, and the leftover still spreads them evenly beyond it.
              gap: 4,
              height: DOCK_HEIGHT,
              borderRadius: radius.pill,
              // Frosted: the surface colour at part strength over a blur of
              // whatever is behind. Solid as before on a binary without blur.
              backgroundColor: blur ? colors.surface + (dark ? 'A6' : 'B3') : colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              // The same inset the slots have above and below, so the row sits an
              // equal distance from every edge of the bar.
              paddingHorizontal: DOCK_PADDING,
            },
            shadow.lifted,
          ]}
        >
          {blur ? (
            <Blur
              intensity={40}
              dark={dark}
              style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, overflow: 'hidden' }]}
            />
          ) : null}
          {/* Each tab is as wide as its own label needs; the add slot is
            fixed-width and trails, and `space-between` shares the remaining
            width out as even gaps. */}
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
                // Content-width, not an equal quarter: at `flex: 1` every tab got
                // the same room regardless of its label, so the longest one
                // ("Dashboard") was the only one that truncated while "List" sat
                // in empty space. The row distributes the slack instead.
                style={({ pressed }) => ({
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                {/* No background behind any tab — the dock is the only surface.
                  Selection is colour alone: accent vs. muted, and a filled
                  glyph vs. an outlined one. */}
                <View
                  style={{
                    height: SLOT,
                    minWidth: SLOT,
                    paddingHorizontal: 6,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  {/* Fixed box around the glyph. The filled and outline variants
                    are the same nominal size, but pinning the slot means the
                    swap can never nudge the label under it. */}
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={(focused ? meta.active : meta.inactive) as never}
                      size={22}
                      color={focused ? colors.accent : colors.inkMuted}
                    />
                  </View>
                  {/*
                  One fixed weight for every tab, focused or not.

                  Switching 500 → 700 on selection made the active label wider,
                  and since the tabs are content-sized inside a `space-between`
                  row, that extra width re-flowed every other tab — the whole
                  bar shifted on each change. 600 reads as deliberate on the
                  active tab without the width changing, and colour plus the
                  filled glyph still carry the selection.
                */}
                  <Text
                    color={focused ? colors.accent : colors.inkMuted}
                    numberOfLines={1}
                    style={{
                      fontSize: 11,
                      lineHeight: 13,
                      fontWeight: '600',
                      includeFontPadding: Platform.OS === 'android' ? false : undefined,
                    }}
                  >
                    {meta.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {/*
          Add action — a one-slot gradient circle, the one filled slot, so it
          reads as the primary action. Round rather than square: it is the only
          element here that is not a tab, and the shape says so before the colour
          does — which is why no divider precedes it. Opens the transaction
          screen (the model has no free-form entry): pick a category and log it.
        */}
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add or ask"
            accessibilityState={{ expanded: menuOpen }}
            hitSlop={6}
            style={({ pressed }) => ({
              width: SLOT,
              height: SLOT,
              borderRadius: SLOT / 2,
              overflow: 'hidden',
              transform: [{ scale: pressed ? 0.92 : 1 }],
            })}
          >
            <LinearGradient
              colors={[colors.gradientStart, colors.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="add" size={23} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      <PlusMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        bottom={bottom}
        tab={state.routes[state.index]?.name}
      />
    </>
  );
}

/**
 * What the + opens: a short menu rising from the button, the + turned into ✕
 * in the same spot so it reads as one control opening and closing.
 *
 *   ┌──────────────────────────────┐
 *   │ (+)  Add transaction          │
 *   │      Log a payment or spend   │
 *   ├──────────────────────────────┤
 *   │ (✦)  Ask AI                   │
 *   │      Money, health and more   │
 *   └──────────────────────────────┘
 *                                (✕)
 *
 * Ask AI opens with the money data on List and Loans, everything allowed
 * elsewhere, and is left out entirely when AI is switched off.
 */
function PlusMenu({
  visible,
  onClose,
  bottom,
  tab,
}: {
  visible: boolean;
  onClose: () => void;
  bottom: number;
  tab: string | undefined;
}) {
  const { colors, radius, shadow, space } = useTheme();
  const router = useRouter();
  const go = (href: string) => {
    onClose();
    router.push(href as never);
  };
  const scope = tab === 'list' || tab === 'loans' ? 'money' : 'global';
  const items: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    body: string;
    href: string;
    gradient: boolean;
  }[] = [
    {
      key: 'add',
      icon: 'add',
      title: 'Add transaction',
      body: 'Log a payment or spending',
      href: '/transaction/new',
      gradient: false,
    },
    ...(isAiEnabled()
      ? [
          {
            key: 'ask',
            icon: 'sparkles' as const,
            title: 'Ask AI',
            body: scope === 'money' ? 'About your bills and accounts' : 'Money, health and more',
            href: `/ask?scope=${scope}`,
            gradient: true,
          },
        ]
      : []),
  ];
  // The + sits at the dock's trailing edge, centred in its padding.
  const plusRight = EDGE_INSET + DOCK_PADDING;
  const plusBottom = bottom + DOCK_PADDING;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close menu"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <View
          style={[
            {
              position: 'absolute',
              right: EDGE_INSET,
              bottom: plusBottom + SLOT + space.md,
              width: 270,
              borderRadius: radius.lg,
              backgroundColor: colors.surfaceRaised,
              borderWidth: 1,
              borderColor: colors.hairline,
              overflow: 'hidden',
            },
            shadow.lifted,
          ]}
        >
          {items.map((item, index) => (
            <Pressable
              key={item.key}
              onPress={() => go(item.href)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.hairline,
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              {item.gradient ? (
                <LinearGradient
                  colors={[colors.gradientStart, colors.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name={item.icon} size={19} color="#FFFFFF" />
                </LinearGradient>
              ) : (
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accentSoft,
                  }}
                >
                  <Ionicons name={item.icon} size={22} color={colors.accent} />
                </View>
              )}
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{item.title}</Text>
                <Text style={{ fontSize: 12, color: colors.inkSecondary }} numberOfLines={1}>
                  {item.body}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* The + become ✕, exactly where the + was. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{
            position: 'absolute',
            right: plusRight,
            bottom: plusBottom,
            width: SLOT,
            height: SLOT,
            borderRadius: SLOT / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.hairline,
          }}
        >
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

