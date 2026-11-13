import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * One scrolling row of tap-to-fill suggestions under a text field.
 *
 * A suggestion fills the field; tapping the selected one clears it. The field
 * stays the source of truth, so anything not in the list can still be typed.
 */
export function SuggestionChips({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  if (options.length === 0) return null;
  const current = value.trim().toLowerCase();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: space.sm }}
    >
      {options.map((option) => {
        const selected = option.toLowerCase() === current;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(selected ? '' : option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              paddingVertical: 7,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.hairline,
              backgroundColor: selected ? colors.accentSoft : colors.surface,
            }}
          >
            <Text
              variant="small"
              color={selected ? colors.accentInk : colors.inkSecondary}
              style={{ fontWeight: selected ? '700' : '500' }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
