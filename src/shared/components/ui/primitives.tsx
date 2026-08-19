/**
 * Typography, surfaces and the small atoms every screen composes from.
 *
 * Nothing here knows about the app's domain — these are the pieces that decide
 * what "a heading" or "a divider" looks like, and they carry the theme lookups
 * so no screen has to.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '~/shared/theme/ThemeProvider';

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
