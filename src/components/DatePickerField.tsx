import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import {
  formatDateLabel,
  isSameDay,
  MONTH_NAMES,
  monthGrid,
  startOfDay,
} from '../core/dates';
import { useTheme } from '../theme/ThemeProvider';
import { BottomSheet, Label, Row, T } from './ui';

/**
 * Pick a full calendar date — the day a transaction actually happened.
 *
 * Distinct from `DayPicker`, which chooses a recurring day-of-month for a bill
 * ("every 15th") and carries no month or year. A transaction is a single event,
 * so it needs a real date: the month it lands in decides which period it counts
 * toward, and back-dating an entry logged a few days late must be possible.
 *
 * Presented as a tappable summary row that opens a month grid, so the common
 * case (today, already filled in) costs nothing and changing it is two taps.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DatePickerField({
  label = 'Date',
  value,
  onChange,
  /** Latest selectable day. Defaults to today — a transaction cannot be future. */
  maximumDate,
}: {
  label?: string;
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = React.useState(false);
  // Which month the grid is showing; re-anchored to the value on each open so
  // reopening never strands the user in a month they browsed away to.
  const [cursor, setCursor] = React.useState(() => startOfDay(value));

  const today = startOfDay(new Date());
  const max = startOfDay(maximumDate ?? today);

  function openPicker() {
    setCursor(startOfDay(value));
    setOpen(true);
  }

  function select(day: number) {
    const picked = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    if (picked > max) return;
    onChange(picked);
    setOpen(false);
  }

  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const isToday = isSameDay(value, today);

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label.toUpperCase()}</Label>

      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDateLabel(value)}. Tap to change.`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.md,
          paddingVertical: 12,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        })}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.accent} />
        <T variant="body" style={{ flex: 1, fontWeight: '600' }}>
          {formatDateLabel(value)}
        </T>
        {/* The exact date alongside "Today" so the relative label is never the
            only information — useful when logging several days at once. */}
        {isToday ? (
          <T variant="caption" tone="muted">
            {value.getDate()} {MONTH_NAMES[value.getMonth()].slice(0, 3)}
          </T>
        ) : null}
        <Ionicons name="chevron-down" size={15} color={colors.inkMuted} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Pick a date"
        icon="calendar-outline"
        iconColor={colors.accent}
      >
        {/* Month navigation. Forward is blocked once the visible month reaches
            the maximum, so a future date cannot be browsed to at all. */}
        <Row justify="space-between" align="center">
          <MonthArrow
            icon="chevron-back"
            label="Previous month"
            onPress={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
          />
          <T variant="bodyStrong">
            {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
          </T>
          <MonthArrow
            icon="chevron-forward"
            label="Next month"
            disabled={
              cursor.getFullYear() === max.getFullYear() && cursor.getMonth() === max.getMonth()
            }
            onPress={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
          />
        </Row>

        <Row gap={0}>
          {WEEKDAYS.map((day, index) => (
            <View key={`${day}-${index}`} style={{ flex: 1, alignItems: 'center' }}>
              <T variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                {day}
              </T>
            </View>
          ))}
        </Row>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((day, index) => {
            if (day === null) {
              return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
            }

            const cellDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);
            const selected = isSameDay(cellDate, value);
            const marksToday = isSameDay(cellDate, today);
            const disabled = cellDate > max;

            return (
              <View key={day} style={{ width: `${100 / 7}%`, height: 44, padding: 2 }}>
                <Pressable
                  onPress={() => select(day)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled }}
                  accessibilityLabel={`${day} ${MONTH_NAMES[cursor.getMonth()]}`}
                  style={({ pressed }) => ({
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.sm,
                    backgroundColor: selected ? colors.accent : 'transparent',
                    borderWidth: marksToday && !selected ? 1.5 : 0,
                    borderColor: colors.accent,
                    opacity: disabled ? 0.25 : pressed ? 0.6 : 1,
                  })}
                >
                  <T
                    variant="small"
                    color={selected ? colors.inkInverse : colors.ink}
                    style={{ fontWeight: selected || marksToday ? '700' : '500' }}
                  >
                    {day}
                  </T>
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* One tap back to the default, for when a browse went astray. */}
        <Pressable
          onPress={() => {
            onChange(today);
            setOpen(false);
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({ alignSelf: 'center', padding: space.sm, opacity: pressed ? 0.6 : 1 })}
        >
          <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
            Today
          </T>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

function MonthArrow({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        padding: space.sm,
        opacity: disabled ? 0.25 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}
