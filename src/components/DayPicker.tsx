import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Label, Row, T } from './ui';

const WEEKS = [
  [1, 2, 3, 4, 5, 6, 7],
  [8, 9, 10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19, 20, 21],
  [22, 23, 24, 25, 26, 27, 28],
  [29, 30, 31],
];

/** Ordinal suffix for the selected-day readout: 1st, 2nd, 3rd, 21st… */
function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][Math.min(day % 10, 4)] ?? 'th';
  return `${day}${suffix}`;
}

/** Day 0 means "no fixed date" — see FLEXIBLE_DUE_DAY in core/planning. */
const FLEXIBLE = 0;

/**
 * Payment-day picker laid out like a month calendar — rows of 7 with the last
 * row short, so the shape reads as "days of a month" rather than a flat wall
 * of numbers. A header states the choice in words ("Every 15th") so the value
 * is legible without decoding the grid, and days past a chosen month-end are
 * flagged as clamping to the last day.
 */
export function DayPicker({
  value,
  onChange,
  label = 'PAYMENT DAY',
}: {
  value: number;
  onChange: (day: number) => void;
  label?: string;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>{label}</Label>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingVertical: 3,
            paddingHorizontal: space.sm,
            borderRadius: 999,
            backgroundColor: colors.accentSoft,
          }}
        >
          <T variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
            {value === FLEXIBLE ? 'No fixed date' : `Every ${ordinal(value)}`}
          </T>
        </View>
      </Row>

      {/* Flexible — for bills with no set date, so they never read as overdue. */}
      <Pressable
        onPress={() => onChange(value === FLEXIBLE ? 1 : FLEXIBLE)}
        accessibilityRole="button"
        accessibilityState={{ selected: value === FLEXIBLE }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingVertical: 10,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: value === FLEXIBLE ? colors.accent : colors.hairline,
          backgroundColor: value === FLEXIBLE ? colors.accentSoft : colors.surface,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Ionicons
          name={value === FLEXIBLE ? 'checkmark-circle' : 'ellipse-outline'}
          size={18}
          color={value === FLEXIBLE ? colors.accent : colors.inkMuted}
        />
        <T
          variant="small"
          color={value === FLEXIBLE ? colors.accentInk : colors.inkSecondary}
          style={{ fontWeight: value === FLEXIBLE ? '700' : '500' }}
        >
          Flexible — no fixed day
        </T>
      </Pressable>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          padding: space.sm,
          gap: 6,
          // Dimmed while flexible: the grid is still tappable (tapping a day
          // switches back to a fixed date) but reads as inactive.
          opacity: value === FLEXIBLE ? 0.45 : 1,
        }}
      >
        {WEEKS.map((week, weekIndex) => (
          <View key={weekIndex} style={{ flexDirection: 'row', gap: 6 }}>
            {week.map((day) => {
              const selected = day === value;
              // The 29th–31st don't exist every month; the app clamps them to
              // the month's last day, so hint that rather than hide them.
              const clamps = day > 28;
              return (
                <Pressable
                  key={day}
                  onPress={() => onChange(day)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Day ${day}`}
                  style={({ pressed }) => ({
                    flex: 1,
                    aspectRatio: 1,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? colors.accent : colors.surfaceSunken,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <T
                    variant="small"
                    color={
                      selected
                        ? colors.inkInverse
                        : clamps
                          ? colors.inkMuted
                          : colors.inkSecondary
                    }
                    style={{ fontWeight: selected ? '800' : '500' }}
                  >
                    {day}
                  </T>
                </Pressable>
              );
            })}
            {/* Pad the short final row so its cells keep the grid's column width. */}
            {week.length < 7
              ? Array.from({ length: 7 - week.length }).map((_, padIndex) => (
                  <View key={`pad-${padIndex}`} style={{ flex: 1 }} />
                ))
              : null}
          </View>
        ))}
      </View>

      {value > 28 ? (
        <T variant="caption" tone="muted">
          On shorter months this falls on the last day.
        </T>
      ) : null}
    </View>
  );
}
