import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { isSameDay, monthGrid, MONTH_NAMES } from '../core/dates';
import { useTheme } from '../theme/ThemeProvider';
import { Label, Row, T } from './ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A read-only month calendar marking the day a bill is due.
 *
 * A due date written as "29 days overdue" tells you the urgency but not *when*
 * — and the thing people actually want to know is which day of the month the
 * money leaves, so they can line it up against payday and the rest of the
 * month's bills. Seeing the date sitting in a real grid answers that at a
 * glance in a way a sentence cannot.
 *
 * Deliberately not interactive: the payment day is edited on the bill itself
 * (via `DayPicker`), so making these cells tappable would offer a second,
 * conflicting way to change it.
 */
export function DueDateCalendar({
  dueDate,
  label = 'When it is due',
  /** Colour for the due-day marker — usually the category's own. */
  tint,
  /** Overdue days render in the danger colour, upcoming in the tint. */
  overdue = false,
}: {
  dueDate: Date;
  label?: string;
  tint?: string;
  overdue?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const accent = overdue ? colors.danger : (tint ?? colors.accent);

  const today = new Date();
  const cells = monthGrid(dueDate.getFullYear(), dueDate.getMonth());

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>{label.toUpperCase()}</Label>
        <Row gap={5}>
          <Ionicons name="calendar-outline" size={13} color={accent} />
          <T variant="caption" color={accent} style={{ fontWeight: '700' }}>
            {dueDate.getDate()} {MONTH_NAMES[dueDate.getMonth()]}
          </T>
        </Row>
      </Row>

      <View
        style={{
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: radius.md,
          padding: space.sm,
          backgroundColor: colors.surface,
        }}
      >
        <Row gap={0}>
          {WEEKDAYS.map((day, index) => (
            <View key={`${day}-${index}`} style={{ flex: 1, alignItems: 'center', paddingBottom: 4 }}>
              <T variant="caption" tone="muted" style={{ fontWeight: '700', fontSize: 10 }}>
                {day}
              </T>
            </View>
          ))}
        </Row>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((day, index) => {
            if (day === null) {
              return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 34 }} />;
            }

            const cellDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), day);
            const isDue = isSameDay(cellDate, dueDate);
            const marksToday = isSameDay(cellDate, today);

            return (
              <View
                key={day}
                style={{
                  width: `${100 / 7}%`,
                  height: 34,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isDue ? accent : 'transparent',
                    // Today is ringed rather than filled, so it never competes
                    // with the due day for attention.
                    borderWidth: marksToday && !isDue ? 1.5 : 0,
                    borderColor: colors.inkMuted,
                  }}
                >
                  <T
                    variant="caption"
                    color={isDue ? colors.inkInverse : colors.ink}
                    style={{ fontWeight: isDue || marksToday ? '800' : '500' }}
                  >
                    {day}
                  </T>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}
