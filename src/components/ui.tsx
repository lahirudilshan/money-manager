import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
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

export function PinnedFooter({
  children,
  flush = false,
  followsKeyboard = false,
}: {
  children: React.ReactNode;
  flush?: boolean;
  /**
   * Lift the footer by the keyboard's height while it is open, instead of
   * relying on a parent KeyboardAvoidingView. Use on screens where the KAV
   * doesn't reach the window bottom (e.g. Expo Router modals), where the footer
   * would otherwise stay hidden behind the keyboard. When the keyboard is up
   * its own inset replaces the safe-area bottom padding.
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
 * A sheet that slides up from the bottom, with a grab handle, a tap-to-dismiss
 * backdrop, and safe-area-aware bottom padding. Rounded top corners and a
 * capped height keep it reading as a sheet rather than a full page. Content is
 * whatever children are passed; a `title` renders a header row with a close
 * button. Prefer this over a centered dialog for pickers and short forms —
 * it's thumb-reachable and feels native on iOS.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightPct = 0.85,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Cap on the sheet's height as a fraction of the screen. */
  maxHeightPct?: number;
}) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop — tap outside the sheet to dismiss. */}
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
      >
        {/* Swallow taps on the sheet body so they don't close it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingBottom: insets.bottom + space.md,
            maxHeight: `${Math.round(maxHeightPct * 100)}%`,
          }}
        >
          {/* Grab handle. */}
          <View style={{ alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs }}>
            <View
              style={{
                width: 40,
                height: 5,
                borderRadius: 999,
                backgroundColor: colors.hairlineStrong,
              }}
            />
          </View>

          {title ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingLeft: space.lg,
                paddingRight: space.lg - space.xs,
                paddingTop: space.xs,
                // Same breathing room below the header as SheetHeader.
                paddingBottom: space.md,
              }}
            >
              <T variant="title">{title}</T>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <Ionicons name="close" size={24} color={colors.inkSecondary} />
              </Pressable>
            </View>
          ) : null}

          {children}
        </Pressable>
      </Pressable>
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
