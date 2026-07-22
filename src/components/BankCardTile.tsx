import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, View } from 'react-native';
import { resolveBrand } from '../data/banks';
import type { Card } from '../db/schema';
import { shadeHex } from '../theme';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

const KIND_ICON: Record<Card['kind'], keyof typeof Ionicons.glyphMap> = {
  bank: 'business',
  wallet: 'wallet',
  savings: 'shield-checkmark',
  goal: 'flag',
};

/**
 * A skeuomorphic bank-card graphic, painted in the account's *bank* brand
 * colour rather than the app gradient, so a wallet of cards is recognisable
 * at a glance the way real cards are. The gradient is derived from the single
 * brand hue (darkened second stop) so every card keeps the same lighting
 * without needing a second colour per bank.
 *
 * `compact` uses a shorter aspect ratio and tighter padding so a list of
 * cards stays scannable rather than each one filling the screen.
 */
export function BankCardTile({
  card,
  onPress,
  compact = false,
}: {
  card: Card;
  onPress?: () => void;
  compact?: boolean;
}) {
  const { radius, shadow, space } = useTheme();

  const brand = resolveBrand({
    bankId: card.bankId,
    bankName: card.bankName,
    name: card.name,
  });
  const pad = compact ? space.md : space.lg;
  const ink = brand.onColor;
  const muted = ink === '#FFFFFF' ? 'rgba(255,255,255,0.78)' : 'rgba(16,24,40,0.66)';

  const body = (
    <View
      style={[
        { aspectRatio: compact ? 2.8 : 1.586, borderRadius: radius.xl, overflow: 'hidden' },
        compact ? shadow.card : shadow.lifted,
      ]}
    >
      <LinearGradient
        colors={[brand.color, shadeHex(brand.color, -0.28)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, padding: pad, justifyContent: 'space-between' }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          {/* EMV chip. */}
          <View
            style={{
              width: compact ? 28 : 34,
              height: compact ? 20 : 24,
              borderRadius: 5,
              backgroundColor: ink === '#FFFFFF' ? 'rgba(255,255,255,0.3)' : 'rgba(16,24,40,0.18)',
            }}
          />
          <Ionicons name={KIND_ICON[card.kind]} size={compact ? 16 : 18} color={muted} />
        </View>

        <View style={{ gap: compact ? 2 : 6 }}>
          <T
            variant="caption"
            color={muted}
            style={{ textTransform: 'uppercase', letterSpacing: 1 }}
          >
            {card.bankName ?? brand.shortName}
          </T>
          {card.last4 ? (
            <T variant="bodyStrong" color={ink} style={{ letterSpacing: 2 }}>
              •••• {card.last4}
            </T>
          ) : null}
          <T variant={compact ? 'bodyStrong' : 'heading'} color={ink} numberOfLines={1}>
            {card.name}
          </T>
        </View>
      </LinearGradient>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
    >
      {body}
    </Pressable>
  );
}
