import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_ICON, statusStyle, type StatusKey } from '../theme';
import { useTheme } from '../theme/ThemeProvider';

type TypeKey =
  | 'hero'
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'small'
  | 'figure'
  | 'figureLarge'
  | 'label'
  | 'caption';

type Tone = 'ink' | 'secondary' | 'muted' | 'inverse' | 'accent';

export function Text({
  children,
  variant = 'body',
  tone = 'ink',
  color,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
  selectable,
}: {
  children: React.ReactNode;
  variant?: TypeKey;
  tone?: Tone;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /**
   * Shrink the text to fit its box rather than truncating. Only takes effect
   * alongside `numberOfLines`, which is what bounds the box to shrink into.
   */
  adjustsFontSizeToFit?: boolean;
  /** Floor for that shrinking, as a fraction of the original size. */
  minimumFontScale?: number;
  /**
   * Let the user select and copy the text. Off by default because selectable
   * body copy interferes with scrolling; worth turning on for anything the user
   * needs to get OUT of the app, like a file path.
   */
  selectable?: boolean;
}) {
  const { colors, type } = useTheme();
  const toneColor = {
    ink: colors.ink,
    secondary: colors.inkSecondary,
    muted: colors.inkMuted,
    inverse: colors.inkInverse,
    accent: colors.accent,
  }[tone];

  return (
    <RNText
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
      selectable={selectable}
      style={[type[variant] as unknown as TextStyle, { color: color ?? toneColor }, style]}
    >
      {children}
    </RNText>
  );
}

/** Uppercase micro-label used above every block. */
export function Label({
  children,
  color,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text variant="label" tone="muted" color={color} style={style}>
      {typeof children === 'string' ? children.toUpperCase() : children}
    </Text>
  );
}

export function Surface({
  children,
  style,
  padded = true,
  raised = false,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  raised?: boolean;
  onPress?: () => void;
}) {
  const { colors, radius, space, shadow } = useTheme();

  const body = (
    <View
      style={[
        {
          backgroundColor: raised ? colors.surfaceRaised : colors.surface,
          borderRadius: radius.lg,
          // Solid 1px (not hairline) so every card matches the quick-action
          // tiles' visible edge — one source of truth for the app's card border.
          borderWidth: 1,
          borderColor: colors.hairline,
          padding: padded ? space.lg : 0,
        },
        shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * The gradient hero surface — the app's signature card. Used for the board's
 * headline and the nav's centre action. Kept as one component so every
 * gradient in the app draws from the same two stops and diagonal.
 */
export function GradientCard({
  children,
  style,
  padded = true,
  gradient,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /**
   * Override the brand gradient — used by the headline cards to colour
   * themselves by plan health (see HEALTH_VISUALS). Omit for the brand pair.
   */
  gradient?: readonly [string, string];
}) {
  const { colors, radius, space, shadow } = useTheme();
  return (
    <View style={[{ borderRadius: radius.xl, overflow: 'hidden' }, shadow.lifted, style]}>
      <LinearGradient
        colors={gradient ?? [colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: padded ? space.xl : 0 }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}

/** Primary action button drawn with the same gradient as the hero card. */
export function GradientButton({
  label,
  onPress,
  icon,
  disabled,
  size = 'md',
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius, space, type } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        { borderRadius: radius.md, overflow: 'hidden', opacity: disabled ? 0.4 : pressed ? 0.88 : 1 },
        style,
      ]}
    >
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          paddingVertical: size === 'sm' ? 9 : 14,
          paddingHorizontal: size === 'sm' ? space.md : space.lg,
        }}
      >
        {icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color="#FFFFFF" /> : null}
        <RNText
          style={[
            (size === 'sm' ? type.small : type.bodyStrong) as unknown as TextStyle,
            { color: '#FFFFFF', fontWeight: '700' },
          ]}
        >
          {label}
        </RNText>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * The standard bottom action bar for a scrolling screen or sheet: a hairline
 * top border, a surface fill, and safe-area-aware bottom padding, holding one
 * or more actions (usually a single full-width GradientButton). Every screen
 * with a fixed bottom button uses this, so the treatment stays identical.
 *
 * Place it as the last child of a flex column, after the ScrollView, so it
 * pins to the bottom while the content scrolls above it. In a bottom-sheet,
 * pass `flush` to drop the safe-area padding (the sheet already insets).
 */
/**
 * The keyboard's current height (0 when hidden), tracked via the Keyboard API.
 * `enabled` lets a caller opt out so screens that don't need it pay nothing.
 * Uses the `Will` events on iOS (they fire with the frame before the animation)
 * and the `Did` events on Android (which lacks the `Will` variants).
 */
function useKeyboardHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);

  return enabled ? height : 0;
}

/**
 * A bottom action bar pinned below a scrolling body — a hairline-topped surface
 * holding the page's primary button(s). Used by full-screen flows (onboarding
 * steps) whose footer is part of the page rather than a modal; modals get their
 * pinned footer from `BottomSheet`'s `footer` prop instead.
 */
/**
 * Bottom padding a scroll view needs so its last item clears `PinnedFooter`.
 *
 * The footer is a SIBLING of the scrolling content, not part of it, so it draws
 * on top: anything within its height of the end of the list is unreachable no
 * matter how far the user scrolls. Screens were padding by `space.lg` (16pt)
 * against a footer that is 100–140pt tall, which silently ate the last card on
 * every onboarding step — including the one naming the plan the user's answers
 * had just produced.
 *
 * Sized for the tallest case (a primary button plus a secondary link above the
 * home indicator). Over-padding costs a little empty space at the end of a
 * scroll; under-padding costs content the user cannot reach at all, so this
 * deliberately errs long.
 */
export const FOOTER_CLEARANCE = 140;

export function PinnedFooter({
  children,
  flush = false,
  followsKeyboard = false,
}: {
  children: React.ReactNode;
  flush?: boolean;
  /**
   * Lift the footer by the keyboard's height while it is open, instead of
   * relying on a parent KeyboardAvoidingView. When the keyboard is up its own
   * inset replaces the safe-area bottom padding.
   */
  followsKeyboard?: boolean;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(followsKeyboard);
  const keyboardUp = keyboardHeight > 0;

  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        // While the keyboard is up, sit flush on top of it; otherwise fall back
        // to the safe-area inset (unless the caller asked to be flush).
        paddingBottom: (keyboardUp ? keyboardHeight : flush ? 0 : insets.bottom) + space.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.hairline,
        backgroundColor: colors.surface,
      }}
    >
      {children}
    </View>
  );
}

/**
 * THE single modal for the whole app — presented as the native iOS sheet
 * (`presentationStyle="pageSheet"`): the OS card that slides up from the bottom
 * with the system grab handle, a gap at the top showing the screen behind, and
 * swipe-down-to-dismiss. Inside it we render our own consistent chrome — a rich
 * header, a scroll/content area, and an optional pinned footer — so every modal
 * and sheet looks identical (the "new bill in" style).
 *
 * Header: always an icon tile + `title`; an optional `eyebrow` shows a small
 * uppercase context line above the title (e.g. "NEW BILL IN"). A close button
 * sits at the right (alongside the native swipe-down). Pass `footer` for a
 * pinned bottom action bar (it lifts with the keyboard).
 *
 * Note: the native sheet owns its own height and grab handle, so there is no
 * `heightPct`/`maxHeightPct` here — the OS sizes it, and the user can drag it.
 */
/**
 * Corner radius on a sheet's top edge. Deliberately larger than `radius.xl`
 * (24) so the curve is visibly the app's rather than the ~10pt iOS draws on a
 * pageSheet by default.
 */
const SHEET_TOP_RADIUS = 28;

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Small uppercase context line above the title (e.g. a parent category). */
  eyebrow?: string;
  /** Leading header icon. Defaults to a neutral list glyph when a title is set. */
  icon?: keyof typeof Ionicons.glyphMap;
  /**
   * Turns the leading icon tile into a BACK button.
   *
   * For a sheet that has a second step inside it — choosing a bank from a long
   * list, say — so the step reads as "further in" rather than as a new sheet
   * stacked on the old one. Close stays in its usual place on the right, so
   * leaving entirely is still one tap from anywhere.
   */
  onBack?: () => void;
  /** Background for the icon tile (e.g. a category colour). Defaults to accent. */
  iconColor?: string;
  /** Pinned footer action bar (keyboard-aware) — usually a GradientButton. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Wrap children in a keyboard-aware ScrollView (for forms). */
  scroll?: boolean;
  /**
   * Set when the sheet IS an expo-router route screen already presented as the
   * native sheet (`presentation: 'modal'`). Then this renders the chrome only —
   * no own `<Modal>` — so it doesn't double-present. Inline sheets omit it and
   * get their own native `<Modal presentationStyle="pageSheet">`.
   */
  asRoute?: boolean;
  /**
   * Present as a full-screen sheet rather than the inset iOS card.
   *
   * For content that needs the whole height and cannot usefully scroll — the PIN
   * pad is the case this exists for: a fixed 3×4 grid of 72pt keys plus a header
   * does not fit the pageSheet inset, and letting it scroll under the thumb is
   * exactly what makes a keypad mis-tap. Use sparingly; the card sheet is the
   * default for a reason.
   */
  fullScreen?: boolean;
};

/** The shared chrome: header + body + footer. Identical in every sheet. */
function SheetChrome({
  onClose,
  onBack,
  title,
  eyebrow,
  icon,
  iconColor,
  footer,
  children,
  scroll,
  fullScreen,
}: SheetProps) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(Boolean(footer));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        /*
         * A fullScreen presentation starts at pixel zero, so its own header
         * would sit under the status bar (clock and battery drawn over the
         * title). A pageSheet is already inset below it by iOS and needs
         * nothing. Rounded corners are likewise a pageSheet affordance — a
         * full-screen surface has no card edge to round, and curving it just
         * exposes whatever is behind the notch.
         */
        paddingTop: fullScreen ? insets.top : 0,
        ...(fullScreen
          ? null
          : {
              /*
               * A rounder top than the OS gives a pageSheet.
               *
               * The native presentation already curves its own corners, but at
               * a radius fixed by iOS — softer than the app's own cards, which
               * makes a sheet read as a system surface rather than part of the
               * product. Drawing our own on top matches the rest of the UI;
               * `overflow: hidden` keeps the header's fill inside the curve
               * rather than squaring it off.
               */
              borderTopLeftRadius: SHEET_TOP_RADIUS,
              borderTopRightRadius: SHEET_TOP_RADIUS,
              overflow: 'hidden' as const,
            }),
      }}
    >
      {/* Rich header: icon tile + optional eyebrow + title + close. Sits just
          below the native grabber. */}
      {title ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingLeft: space.lg,
              paddingRight: space.lg - space.xs,
              paddingTop: space.md,
              paddingBottom: space.md,
            }}
          >
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <Ionicons name="chevron-back" size={24} color={colors.inkSecondary} />
              </Pressable>
            ) : (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  backgroundColor: iconColor ?? colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={(icon ?? 'albums-outline') as never} size={20} color="#FFFFFF" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              {eyebrow ? (
                <Text variant="caption" tone="muted">
                  {eyebrow.toUpperCase()}
                </Text>
              ) : null}
              <Text variant="heading" numberOfLines={1}>
                {title}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              <Ionicons name="close" size={24} color={colors.inkSecondary} />
            </Pressable>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }} />
        </>
      ) : null}

      {/* Body — optionally a keyboard-aware scroll area so it flexes and the
          footer pins to the bottom. */}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}

      {/* Pinned footer — lifts with the keyboard when open. */}
      {footer ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: (keyboardHeight > 0 ? keyboardHeight : insets.bottom) + space.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.hairline,
            backgroundColor: colors.surface,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function BottomSheet(props: SheetProps) {
  const { colors } = useTheme();

  // Route sheets are already the native sheet (the expo-router 'modal' screen),
  // so they render the chrome directly — one presentation, identical to the
  // inline "add bill" sheet. Inline sheets wrap the chrome in their own native
  // `<Modal presentationStyle="pageSheet">`.
  if (props.asRoute) {
    if (!props.visible) return null;
    return <SheetChrome {...props} />;
  }

  return (
    <Modal
      visible={props.visible}
      // The native iOS card sheet: slides up, shows the screen behind at the
      // top, has the system grabber, and can be swiped down to dismiss.
      // `fullScreen` opts out for content that needs the whole height (the PIN
      // pad), where the inset card would clip a fixed-size keypad.
      presentationStyle={props.fullScreen ? 'fullScreen' : 'pageSheet'}
      animationType="slide"
      /*
       * The modal's backdrop, which defaults to WHITE.
       *
       * `SheetChrome` rounds the sheet's top corners more than iOS rounds a
       * pageSheet, and the backdrop shows through that difference — four bright
       * notches at the top of every sheet, glaring against a dark surface.
       * Painting the backdrop with the same surface colour makes the gap
       * invisible.
       *
       * `transparent` would be the other way to do it, but RN explicitly warns
       * that it is unsupported alongside a presentationStyle.
       */
      backdropColor={colors.surface}
      // Fires for both the swipe-down dismiss and the Android hardware back.
      onRequestClose={props.onClose}
    >
      <SheetChrome {...props} />
    </Modal>
  );
}

/**
 * Status pill. Always carries an icon and a word — status is never encoded by
 * colour alone, which also keeps it readable in greyscale and for CVD users.
 */
export function StatusPill({
  status,
  compact = false,
}: {
  status: StatusKey;
  compact?: boolean;
}) {
  const { colors, radius, space, type } = useTheme();
  const style = statusStyle(status, colors);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: style.bg,
        paddingHorizontal: compact ? space.sm : space.md,
        paddingVertical: compact ? 3 : 5,
        borderRadius: radius.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Ionicons name={STATUS_ICON[status] as never} size={compact ? 11 : 13} color={style.fg} />
      <RNText style={[type.label as unknown as TextStyle, { color: style.fg }]}>
        {style.label.toUpperCase()}
      </RNText>
    </View>
  );
}

/**
 * Compact strip encoding every category's status in one row — the "how is this
 * group doing" glance. Each segment is one category, coloured by its state.
 */
export function StatusStrip({
  counts,
  total,
  height = 6,
}: {
  counts: { pending: number; paid: number };
  total: number;
  height?: number;
}) {
  const { colors, radius } = useTheme();
  if (total === 0) {
    return (
      <View
        style={{
          height,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSunken,
        }}
      />
    );
  }

  const segments: { key: string; count: number; color: string }[] = [
    { key: 'paid', count: counts.paid, color: colors.completed },
    { key: 'pending', count: counts.pending, color: colors.pending },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        height,
        borderRadius: radius.pill,
        overflow: 'hidden',
        backgroundColor: colors.surfaceSunken,
        // 2px gaps between segments keep adjacent fills legible.
        gap: 2,
      }}
    >
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment) => (
          <View
            key={segment.key}
            style={{
              flex: segment.count,
              backgroundColor: segment.color,
            }}
          />
        ))}
    </View>
  );
}

/**
 * Funding meter. Shows how much of a group's plan has been transferred, with
 * an overfill state so a surplus is visible rather than silently clamped.
 */
export function FundingBar({
  pct,
  color,
  height = 8,
  surplus = false,
}: {
  pct: number;
  color: string;
  height?: number;
  surplus?: boolean;
}) {
  const { colors, radius } = useTheme();
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceSunken,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: '100%',
          backgroundColor: surplus ? colors.completed : color,
          borderRadius: radius.pill,
        }}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  size = 'md',
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius, space, type } = useTheme();

  const variants = {
    primary: { bg: colors.accent, fg: colors.inkInverse, border: 'transparent' },
    secondary: { bg: colors.surface, fg: colors.ink, border: colors.hairlineStrong },
    ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: 'transparent' },
    success: { bg: colors.completed, fg: colors.inkInverse, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          backgroundColor: variants.bg,
          borderColor: variants.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
          paddingVertical: size === 'sm' ? 9 : 14,
          paddingHorizontal: size === 'sm' ? space.md : space.lg,
          borderRadius: radius.md,
          opacity: disabled ? 0.4 : pressed ? 0.86 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variants.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={variants.fg} /> : null}
          <RNText
            style={[
              (size === 'sm' ? type.small : type.bodyStrong) as unknown as TextStyle,
              { color: variants.fg, fontWeight: '600' },
            ]}
          >
            {label}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

export function Glyph({
  icon,
  color,
  size = 38,
  filled = false,
  gradient,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  size?: number;
  filled?: boolean;
  /**
   * Fill the tile with a gradient instead of a flat tint, for a row belonging
   * to a branded feature. Overrides `color` and `filled`; the glyph goes white,
   * as it does on every other gradient surface in the app.
   */
  gradient?: readonly [string, string];
}) {
  const box = {
    width: size,
    height: size,
    borderRadius: size / 3.2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  if (gradient) {
    return (
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={box}
      >
        <Ionicons name={icon} size={size * 0.48} color="#FFFFFF" />
      </LinearGradient>
    );
  }

  return (
    <View style={[box, { backgroundColor: filled ? color : `${color}18` }]}>
      <Ionicons name={icon} size={size * 0.48} color={filled ? '#FFFFFF' : color} />
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }, style]}
    />
  );
}

export function Row({
  children,
  gap,
  align = 'center',
  justify,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
}) {
  const { space } = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap: gap ?? space.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Empty({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors, space } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxxl, gap: space.sm }}>
      <Glyph icon={icon} color={colors.inkMuted} size={52} />
      <Text variant="heading">{title}</Text>
      <Text variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="ghost" />
      ) : null}
    </View>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string };
}) {
  const { colors, space } = useTheme();
  return (
    <Row justify="space-between" style={{ marginBottom: space.md }}>
      <View style={{ gap: 1 }}>
        <Label>{eyebrow}</Label>
        <Text variant="title">{title}</Text>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => ({ borderRadius: 14, overflow: 'hidden', opacity: pressed ? 0.85 : 1 })}
        >
          <LinearGradient
            colors={[colors.gradientStart, colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={action.icon} size={22} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      ) : null}
    </Row>
  );
}

/**
 * Bold tinted tile for a group — the board's primary unit. Colour fills the
 * tile background (not just a dot or hairline) so the grid reads as
 * distinctly coloured buckets at a glance, then every value is still labelled
 * in text so colour is never the only signal.
 */
export function GroupTile({
  icon,
  color,
  tint,
  name,
  amount,
  subtitle,
  progressLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  tint: string;
  name: string;
  amount: string;
  subtitle: string;
  progressLabel: string;
  onPress: () => void;
}) {
  const { colors, radius, space, shadow } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          borderRadius: radius.lg,
          backgroundColor: tint,
          borderWidth: 1,
          borderColor: `${color}33`,
          padding: space.lg,
          gap: space.sm,
          opacity: pressed ? 0.92 : 1,
        },
        shadow.card,
      ]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color,
        }}
      >
        <Ionicons name={icon} size={19} color="#FFFFFF" />
      </View>
      <Text variant="bodyStrong" numberOfLines={1} color={colors.ink}>
        {name}
      </Text>
      <Text variant="figureLarge" color={colors.ink}>
        {amount}
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {subtitle}
      </Text>
      <View
        style={{
          alignSelf: 'flex-start',
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: `${color}26`,
        }}
      >
        <Text variant="caption" color={color} style={{ fontWeight: '700' }}>
          {progressLabel}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The one list-row primitive: a leading visual, a title + optional subtitle
 * column, an optional trailing node (a value, a switch, a badge…), and an
 * optional chevron. Tappable when `onPress` is given. This replaces the ~18
 * hand-rolled `Pressable{row}` variants across the app so every row shares the
 * same height, padding, press feedback and alignment.
 *
 * `leading` is any node (a BankLogo, a Glyph, an icon tile). `trailing` is any
 * node shown right-aligned before the chevron. Keep row-specific decoration in
 * those slots; the shell only owns layout.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  chevron = false,
  onPress,
  titleColor,
  strikethrough = false,
  accessibilityLabel,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  titleColor?: string;
  strikethrough?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors, space } = useTheme();

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      {leading}
      {/* `gap` rather than a margin on the subtitle: the row can also take a
          custom ReactNode subtitle, and only the gap spaces that one too. */}
      <View style={{ flex: 1, gap: 4 }}>
        {typeof title === 'string' ? (
          <Text
            variant="bodyStrong"
            numberOfLines={1}
            color={titleColor}
            style={strikethrough ? { textDecorationLine: 'line-through' } : undefined}
          >
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle != null ? (
          typeof subtitle === 'string' ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {trailing}
      {chevron ? <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} /> : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * A labelled figure — the small "LABEL / value" stat repeated across every
 * summary card and hero. `inline` lays it out as a label↔value row (for stacked
 * lists like "This month"); the default stacks the label over the figure (for
 * hero rows). `onDark` switches to white-on-gradient treatment. Replaces the
 * per-screen HeroStat / SummaryStat / StatRow / CardStat re-declarations.
 */
export function Stat({
  label,
  value,
  color,
  inline = false,
  onDark = false,
  large = false,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  color?: string;
  inline?: boolean;
  onDark?: boolean;
  large?: boolean;
  align?: ViewStyle['alignItems'];
}) {
  const { colors } = useTheme();
  const labelColor = onDark ? 'rgba(255,255,255,0.65)' : undefined;
  const valueColor = color ?? (onDark ? '#FFFFFF' : colors.ink);

  if (inline) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="small" tone={onDark ? undefined : 'secondary'} color={onDark ? 'rgba(255,255,255,0.75)' : undefined}>
          {label}
        </Text>
        <Text variant="figure" color={valueColor}>
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 2, alignItems: align }}>
      <Label color={labelColor}>{label}</Label>
      <Text variant={large ? 'figureLarge' : 'figure'} color={valueColor} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A label ↔ value row for detail sheets (account number, branch, expiry…), with
 * an optional trailing action (e.g. a reveal eye). One definition replaces the
 * byte-identical copies that lived in cards.tsx and account/[id].tsx.
 */
export function DetailRow({
  label,
  value,
  action,
  muted,
}: {
  label: string;
  value: string;
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
  /**
   * Dim the value, for a placeholder like "Not set".
   *
   * Keeps an unfilled row readable as a gap rather than as data, so a column of
   * details still reads at a glance as "these three are set, this one is not".
   */
  muted?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <Text variant="small" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text
          variant="small"
          tone={muted ? 'muted' : undefined}
          style={{ fontWeight: muted ? '400' : '600' }}
        >
          {value}
        </Text>
        {action ? (
          <Pressable
            onPress={action.onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Ionicons name={action.icon} size={18} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A fixed screen header — a safe-area-aware bar with an optional back chevron, a
 * title, and an optional right action (or arbitrary `right` node), over a
 * hairline bottom border. Stays put while the body scrolls beneath it. Replaces
 * the hand-rolled fixed headers on the accounts/income/etc. screens so they
 * share one structure, spacing and back-button treatment.
 */
export function AppHeader({
  title,
  onBack,
  action,
  right,
}: {
  title: string;
  onBack?: () => void;
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string };
  right?: React.ReactNode;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.sm,
        backgroundColor: colors.canvas,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairline,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
      ) : (
        <View style={{ width: 24 }} />
      )}
      <Text variant="title">{title}</Text>
      {right ??
        (action ? (
          <Pressable
            onPress={action.onPress}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name={action.icon} size={28} color={colors.accent} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        ))}
    </View>
  );
}

/**
 * A titled group: a section label (with an optional note) over a Surface that
 * holds a set of rows, divided from the header. The standard way to present a
 * grouped list — replaces the per-screen `<Label>` + `<Surface padded={false}>`
 * reimplementations (settings, income, accounts, category/account detail…).
 */
/**
 * The header every onboarding step opens with: "STEP N OF 5", a progress bar,
 * a title and a line of explanation.
 *
 * One component rather than the same four elements pasted into five screens —
 * the bar has to advance in lockstep with the label, and two copies of that
 * pairing is two chances for a screen to say "step 3" while filling four
 * segments.
 *
 * The bar sits directly under the label because they are the same statement
 * twice: "STEP 2 OF 5" is a number to parse, the filled bar is a glance. Split
 * apart — the label above the title and the bar below the description — they
 * read as two unrelated pieces of chrome.
 *
 * ## It is pinned, not scrolled
 *
 * This renders as a SIBLING of the step's scroll area rather than its first
 * child, so "where am I in setup?" stays answerable after the first flick.
 * Steps 1, 3 and 4 are long enough to scroll the header away entirely, and a
 * progress bar you have to scroll back up to find is not doing its job.
 *
 * Because it sits outside the scroll area it also owns the top safe-area inset
 * and paints the canvas — content passing underneath must not show through the
 * notch — which is why each screen's scroll container no longer adds
 * `insets.top` of its own.
 *
 * ## Going back
 *
 * `onBack` puts a back control on the step label's row. Onboarding is a forward
 * push stack with no native header, so without this the ONLY way back was the
 * iOS edge-swipe — undiscoverable, and unavailable on Android. Steps that have
 * nowhere to go back to (the first one) simply omit the prop and the row keeps
 * its layout.
 */
export function StepHeader({
  step,
  total = 5,
  title,
  onBack,
  children,
}: {
  step: number;
  total?: number;
  title: string;
  /** Shows a back control. Omit on the first step, which has no previous one. */
  onBack?: () => void;
  /** The line of explanation under the title. */
  children?: React.ReactNode;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        gap: 2,
        backgroundColor: colors.canvas,
        paddingTop: insets.top + space.lg,
        paddingHorizontal: space.lg,
        paddingBottom: space.md,
      }}
    >
      {onBack ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {/*
            Pulled left by its own padding so the arrow's optical edge lines up
            with the title below it, while the tap target stays a comfortable
            size rather than shrinking to the glyph.
          */}
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={({ pressed }) => ({
              marginLeft: -space.xs,
              paddingVertical: 2,
              paddingHorizontal: space.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="chevron-back" size={18} color={colors.inkMuted} />
          </Pressable>
          <Label>{`STEP ${step} OF ${total}`}</Label>
        </View>
      ) : (
        <Label>{`STEP ${step} OF ${total}`}</Label>
      )}

      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${step} of ${total}`}
        style={{ flexDirection: 'row', gap: space.xs, paddingVertical: space.xs }}
      >
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i < step ? colors.accent : colors.hairline,
            }}
          />
        ))}
      </View>

      <Text variant="title">{title}</Text>
      {typeof children === 'string' ? (
        <Text variant="small" tone="muted">
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export function Section({
  title,
  note,
  children,
  accent,
  icon,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  /**
   * Tint the card's border and its heading, marking the section as belonging to
   * a named feature rather than being ordinary settings chrome.
   *
   * Kept to the border and the label on purpose: a tinted background or a
   * thicker rule would make the section shout for attention it does not need,
   * and every row inside it still has to read as a plain settings row.
   */
  accent?: string;
  /**
   * A glyph beside the heading, for a section that belongs to a named feature.
   *
   * Takes `accent`'s colour when one is set, so the icon, the label and the
   * border stay a single deliberate accent rather than three near-matches.
   */
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors, space } = useTheme();
  return (
    <Surface style={accent ? { gap: space.xs, borderColor: accent } : { gap: space.xs }} padded={false}>
      <View style={{ padding: space.lg, paddingBottom: note ? space.xs : space.md, gap: space.xs }}>
        {icon ? (
          <Row gap={6}>
            <Ionicons name={icon} size={12} color={accent ?? colors.inkMuted} />
            <Label color={accent}>{title}</Label>
          </Row>
        ) : (
          <Label color={accent}>{title}</Label>
        )}
        {note ? (
          <Text variant="caption" tone="muted">
            {note}
          </Text>
        ) : null}
      </View>
      <Divider />
      {children}
    </Surface>
  );
}
