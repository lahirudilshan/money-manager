import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import type { BankBrand } from '../data/banks';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

/**
 * A bank's mark: its monogram on its brand colour. Stands in for a real logo
 * (see src/data/banks.ts for why) and is the single place that decision is
 * expressed, so swapping in image assets later means changing only this file.
 */
export function BankLogo({
  brand,
  size = 44,
  style,
}: {
  brand: BankBrand;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessible
      accessibilityLabel={brand.name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 3.4,
          backgroundColor: brand.color,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <T
        variant="label"
        color={brand.onColor}
        style={{
          // Scales with the tile so 2- and 3-letter monograms both fit.
          fontSize: Math.max(10, size * (brand.monogram.length > 2 ? 0.26 : 0.32)),
          letterSpacing: 0.3,
          fontWeight: '800',
        }}
      >
        {brand.monogram}
      </T>
    </View>
  );
}

/**
 * Selectable bank card used by the onboarding picker: the brand colour fills
 * the whole tile so the grid reads as a wall of recognisable banks. Selection
 * is shown by a check badge and a ring, never by colour alone — every tile is
 * already strongly coloured, so colour carries no state here.
 */
export function BankSelectTile({
  brand,
  selected,
  onPress,
}: {
  brand: BankBrand;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space, shadow } = useTheme();
  const badgeBg = brand.onColor === '#FFFFFF' ? 'rgba(255,255,255,0.95)' : colors.ink;
  const badgeInk = brand.onColor === '#FFFFFF' ? '#101828' : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={brand.name}
      style={({ pressed }) => [
        {
          backgroundColor: brand.color,
          borderRadius: radius.lg,
          padding: space.md,
          minHeight: 92,
          justifyContent: 'space-between',
          borderWidth: 2,
          borderColor: selected ? colors.ink : 'transparent',
          opacity: pressed ? 0.85 : 1,
        },
        shadow.card,
      ]}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <T
          variant="figureLarge"
          color={brand.onColor}
          style={{ fontWeight: '800', letterSpacing: 0.5 }}
        >
          {brand.monogram}
        </T>
        {selected ? (
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: badgeBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark" size={14} color={badgeInk} />
          </View>
        ) : (
          <View style={{ width: 22, height: 22 }} />
        )}
      </View>

      <T variant="caption" color={brand.onColor} numberOfLines={2} style={{ opacity: 0.95 }}>
        {brand.name}
      </T>
    </Pressable>
  );
}
