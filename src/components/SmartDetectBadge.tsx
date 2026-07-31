import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './ui';

/**
 * The one place the Smart Detect feature is named and styled.
 *
 * The feature is called "Smart Detect" everywhere rather than "AI": it is local
 * pattern-matching over bank SMS plus a merchant→bill map that learns from each
 * correction. That is genuinely smart behaviour, but no model is involved, and
 * labelling it AI would be a claim the code does not make good on — a paying
 * user would be buying something that does not exist.
 *
 * Rendered as a gradient pill so the premium feature looks distinct from the
 * app's ordinary chrome wherever it appears.
 */
export function SmartDetectBadge({
  size = 'md',
  showLock,
}: {
  size?: 'sm' | 'md';
  /** Marks the feature as not yet unlocked on the current plan. */
  showLock?: boolean;
}) {
  const { colors, radius } = useTheme();
  const small = size === 'sm';

  return (
    <View style={{ borderRadius: radius.pill, overflow: 'hidden', alignSelf: 'flex-start' }}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: small ? 7 : 9,
          paddingVertical: small ? 3 : 4,
        }}
      >
        <Ionicons name={showLock ? 'lock-closed' : 'sparkles'} size={small ? 10 : 12} color="#FFFFFF" />
        <Text
          variant="caption"
          color="#FFFFFF"
          style={{ fontWeight: '800', fontSize: small ? 9 : 10, letterSpacing: 0.3 }}
        >
          {SMART_DETECT_NAME.toUpperCase()}
        </Text>
      </LinearGradient>
    </View>
  );
}

/** The feature's name, so every mention of it agrees. */
export const SMART_DETECT_NAME = 'Smart Detect';

/** One-line description, for headers and the upgrade prompt. */
export const SMART_DETECT_TAGLINE =
  'Reads your bank messages into ready-to-confirm drafts, and learns each merchant as you correct it.';
