import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, View } from 'react-native';
import type { Card } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

const KIND_ICON: Record<Card['kind'], keyof typeof Ionicons.glyphMap> = {
  bank: 'business',
  wallet: 'wallet',
  savings: 'shield-checkmark',
  goal: 'flag',
};

/**
 * A skeuomorphic bank-card graphic. Every card uses the same brand gradient —
 * cards are no longer distinguished by individual hue, only by name/bank/icon —
 * so the face stays deliberately clean: no balance, no stats, just identity.
 */
export function BankCardTile({ card, onPress }: { card: Card; onPress?: () => void }) {
  const { colors, radius, shadow, space } = useTheme();

  const body = (
    <View style={[{ aspectRatio: 1.586, borderRadius: radius.xl, overflow: 'hidden' }, shadow.lifted]}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, padding: space.lg, justifyContent: 'space-between' }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View
            style={{
              width: 34,
              height: 24,
              borderRadius: 5,
              backgroundColor: 'rgba(255,255,255,0.25)',
            }}
          />
          <Ionicons name={KIND_ICON[card.kind]} size={18} color="rgba(255,255,255,0.85)" />
        </View>

        <View style={{ gap: 6 }}>
          {card.bankName ? (
            <T
              variant="caption"
              color="rgba(255,255,255,0.75)"
              style={{ textTransform: 'uppercase', letterSpacing: 1 }}
            >
              {card.bankName}
            </T>
          ) : null}
          {card.last4 ? (
            <T variant="bodyStrong" color="#FFFFFF" style={{ letterSpacing: 2 }}>
              •••• {card.last4}
            </T>
          ) : null}
          <T variant="heading" color="#FFFFFF" numberOfLines={1}>
            {card.name}
          </T>
        </View>
      </LinearGradient>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}>
      {body}
    </Pressable>
  );
}
