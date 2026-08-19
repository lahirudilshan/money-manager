import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { Text } from '~/shared/components/ui';

/**
 * One day in a calendar grid — the single source of truth for how a day looks.
 *
 * Three screens draw a month grid (`DayPicker`, `DueDateCalendar`,
 * `DatePickerField`) and each had grown its own cell, which is how one of them
 * ended up circular while the others stayed square. They all render this now, so
 * a day reads the same everywhere.
 *
 * The shape is a **square with a small corner radius**, matching the app's tiles
 * and inputs. A circle was tried and rejected: a filled circle in a grid of
 * squares reads as a different kind of object, and it wastes the corners a date
 * needs when the grid is tight.
 *
 * Selection is a solid fill; "today" is a ring when unselected, so the two states
 * can coexist on the same cell without either being lost. Pass `onPress` for an
 * interactive grid, omit it for a read-only one — a read-only cell renders as a
 * plain View so it is not focusable by a screen reader as a control.
 */
export function DayCell({
  day,
  selected = false,
  marksToday = false,
  disabled = false,
  /** Fill for the selected state; defaults to the brand accent. */
  tint,
  /** Background when neither selected nor today. Transparent by default. */
  restBackground,
  /** Colour for the day number when at rest, for grids that dim some days. */
  restColor,
  /** Ring colour for today when unselected; defaults to the tint. */
  todayRing,
  onPress,
  accessibilityLabel,
}: {
  day: number;
  selected?: boolean;
  marksToday?: boolean;
  disabled?: boolean;
  tint?: string;
  restBackground?: string;
  restColor?: string;
  todayRing?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors, radius } = useTheme();
  const accent = tint ?? colors.accent;

  const body = (pressed: boolean) => ({
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    // Square with a small radius — the shape shared with the app's tiles.
    borderRadius: radius.sm,
    backgroundColor: selected ? accent : (restBackground ?? 'transparent'),
    // Today is ringed rather than filled, so it never competes with the
    // selection for attention.
    borderWidth: marksToday && !selected ? 1.5 : 0,
    borderColor: todayRing ?? accent,
    opacity: disabled ? 0.25 : pressed ? 0.6 : 1,
  });

  const text = (
    <Text
      variant="small"
      color={selected ? colors.inkInverse : (restColor ?? colors.ink)}
      style={{ fontWeight: selected || marksToday ? '800' : '500' }}
    >
      {day}
    </Text>
  );

  if (!onPress) {
    return <View style={body(false)}>{text}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => body(pressed)}
    >
      {text}
    </Pressable>
  );
}
