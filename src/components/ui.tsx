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
  Text,
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

export function T({
  children,
  variant = 'body',
  tone = 'ink',
  color,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  variant?: TypeKey;
  tone?: Tone;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
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
    <Text
      numberOfLines={numberOfLines}
      style={[type[variant] as unknown as TextStyle, { color: color ?? toneColor }, style]}
    >
      {children}
    </Text>
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
    <T variant="label" tone="muted" color={color} style={style}>
      {typeof children === 'string' ? children.toUpperCase() : children}
    </T>
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
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const { colors, radius, space, shadow } = useTheme();
  return (
    <View style={[{ borderRadius: radius.xl, overflow: 'hidden' }, shadow.lifted, style]}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
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
        <Text
          style={[
            (size === 'sm' ? type.small : type.bodyStrong) as unknown as TextStyle,
            { color: '#FFFFFF', fontWeight: '700' },
          ]}
        >
          {label}
        </Text>
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
type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Small uppercase context line above the title (e.g. a parent category). */
  eyebrow?: string;
  /** Leading header icon. Defaults to a neutral list glyph when a title is set. */
  icon?: keyof typeof Ionicons.glyphMap;
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
};

/** The shared chrome: header + body + footer. Identical in every sheet. */
function SheetChrome({ onClose, title, eyebrow, icon, iconColor, footer, children, scroll }: SheetProps) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(Boolean(footer));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
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
            <View style={{ flex: 1 }}>
              {eyebrow ? (
                <T variant="caption" tone="muted">
                  {eyebrow.toUpperCase()}
                </T>
              ) : null}
              <T variant="heading" numberOfLines={1}>
                {title}
              </T>
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
      presentationStyle="pageSheet"
      animationType="slide"
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
      <Text style={[type.label as unknown as TextStyle, { color: style.fg }]}>
        {style.label.toUpperCase()}
      </Text>
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
          <Text
            style={[
              (size === 'sm' ? type.small : type.bodyStrong) as unknown as TextStyle,
              { color: variants.fg, fontWeight: '600' },
            ]}
          >
            {label}
          </Text>
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 3.2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? color : `${color}18`,
      }}
    >
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
      <T variant="heading">{title}</T>
      <T variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
        {message}
      </T>
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
        <T variant="title">{title}</T>
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
      <T variant="bodyStrong" numberOfLines={1} color={colors.ink}>
        {name}
      </T>
      <T variant="figureLarge" color={colors.ink}>
        {amount}
      </T>
      <T variant="caption" tone="secondary" numberOfLines={1}>
        {subtitle}
      </T>
      <View
        style={{
          alignSelf: 'flex-start',
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: `${color}26`,
        }}
      >
        <T variant="caption" color={color} style={{ fontWeight: '700' }}>
          {progressLabel}
        </T>
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
      <View style={{ flex: 1, gap: 1 }}>
        {typeof title === 'string' ? (
          <T
            variant="bodyStrong"
            numberOfLines={1}
            color={titleColor}
            style={strikethrough ? { textDecorationLine: 'line-through' } : undefined}
          >
            {title}
          </T>
        ) : (
          title
        )}
        {subtitle != null ? (
          typeof subtitle === 'string' ? (
            <T variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </T>
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
        <T variant="small" tone={onDark ? undefined : 'secondary'} color={onDark ? 'rgba(255,255,255,0.75)' : undefined}>
          {label}
        </T>
        <T variant="figure" color={valueColor}>
          {value}
        </T>
      </View>
    );
  }

  return (
    <View style={{ gap: 2, alignItems: align }}>
      <Label color={labelColor}>{label}</Label>
      <T variant={large ? 'figureLarge' : 'figure'} color={valueColor} numberOfLines={1}>
        {value}
      </T>
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
}: {
  label: string;
  value: string;
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
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
      <T variant="small" tone="muted">
        {label}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <T variant="small" style={{ fontWeight: '600' }}>
          {value}
        </T>
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
      <T variant="title">{title}</T>
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
export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  const { space } = useTheme();
  return (
    <Surface style={{ gap: space.xs }} padded={false}>
      <View style={{ padding: space.lg, paddingBottom: note ? space.xs : space.md, gap: space.xs }}>
        <Label>{title}</Label>
        {note ? (
          <T variant="caption" tone="muted">
            {note}
          </T>
        ) : null}
      </View>
      <Divider />
      {children}
    </Surface>
  );
}
