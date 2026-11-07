import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import { Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { preloadSearchIndex } from './useSearchIndex';

/**
 * The dashboard's search bar. Not an input: a tap opens the Search screen,
 * which searches everything, so the dashboard never grows a results list.
 */
export function SearchBar() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();

  // Warm Search's data while the dashboard sits idle, so opening it is instant.
  useEffect(preloadSearchIndex, []);

  return (
    <Pressable
      onPress={() => router.push('/search')}
      accessibilityRole="search"
      accessibilityLabel="Search everything"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderRadius: radius.pill,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name="search" size={18} color={colors.inkSecondary} />
      <Text variant="body" color={colors.inkFaint} style={{ fontSize: 15 }}>
        Search anything — bills, documents, SMS…
      </Text>
    </Pressable>
  );
}
