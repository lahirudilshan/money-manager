import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { MONTH_NAMES } from '~/shared/lib/dates';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { DayCell } from './DayCell';
import { Label, Row, Text } from '~/shared/components/ui';

/**
 * Days 1–31 in rows of seven — the exact layout the "new bill in" sheet's
 * `DayPicker` uses, so the grid a user picks a payment day on and the grid that
 * reports it back are the same object in two states.
 */
const WEEKS = [
  [1, 2, 3, 4, 5, 6, 7],
  [8, 9, 10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19, 20, 21],
  [22, 23, 24, 25, 26, 27, 28],
  [29, 30, 31],
];

/**
 * A read-only month calendar marking the day a bill is due.
 *
 * A due date written as "29 days overdue" tells you the urgency but not *when*
 * — and the thing people actually want to know is which day of the month the
 * money leaves, so they can line it up against payday and the rest of the
 * month's bills. Seeing the date sitting in a real grid answers that at a
 * glance in a way a sentence cannot.
 *
 * Presented as a day-of-month grid rather than a true weekday calendar, matching
 * `DayPicker`: a payment day IS a day of the month ("every 15th"), so aligning
 * it under S/M/T/W columns implied a precision — a specific weekday — that the
 * underlying value does not carry.
 *
 * Deliberately not interactive: the payment day is edited on the bill itself
 * (via `DayPicker`), so making these cells tappable would offer a second,
 * conflicting way to change it.
 */
export function DueDateCalendar({
  dueDate,
  label = 'When it is due',
  /**
   * Tap handler for a day. Omit it and the grid stays read-only.
   *
   * Optional rather than required because this calendar is also used purely to
   * REPORT a date, and a grid whose cells depress but change nothing is worse
   * than one that plainly does not invite the touch.
   */
  onDayPress,
}: {
  dueDate: Date;
  label?: string;
  onDayPress?: (day: number) => void;
}) {
  const { colors, radius, space, mode } = useTheme();
  /*
   * The due day is always BLUE, whatever its state.
   *
   * It previously took the category's own colour, and amber once the bill was
   * overdue — so the one cell the grid exists to point at changed hue depending
   * on the line you opened it from. Fixing it to the app's accent makes "this
   * is the day" mean one thing everywhere, and leaves the yellow today-wash as
   * the only other mark, which the two can no longer be confused for.
   *
   * Overdue is still communicated — the header's relative date and the board
   * row both say so — it simply is not said by recolouring the calendar.
   */
  const accent = colors.accent;

  // A light yellow wash marks today, so it reads as a gentle "you are here"
  // beside the blue due-day cell rather than competing with it.
  const todayTint = mode === 'dark' ? 'rgba(224,168,80,0.22)' : 'rgba(250,214,110,0.38)';
  const todayInk = mode === 'dark' ? '#E7C06A' : '#8A6D0F';

  const now = new Date();
  // The due day is only "today" when the calendar is showing the current month.
  const showsThisMonth =
    dueDate.getFullYear() === now.getFullYear() && dueDate.getMonth() === now.getMonth();
  const todayDay = showsThisMonth ? now.getDate() : -1;
  const dueDay = dueDate.getDate();

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>{label.toUpperCase()}</Label>
        <Row gap={5}>
          <Ionicons name="calendar-outline" size={13} color={accent} />
          <Text variant="caption" color={accent} style={{ fontWeight: '700' }}>
            {dueDate.getDate()} {MONTH_NAMES[dueDate.getMonth()]}
          </Text>
        </Row>
      </Row>

      {/* Panel and cells match the "new bill in" sheet's DayPicker: same
          radius, same 6px gutters, same filled cells on the sunken ground,
          same yellow today-wash. */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          padding: space.sm,
          gap: 6,
        }}
      >
        {WEEKS.map((week, weekIndex) => (
          <View key={weekIndex} style={{ flexDirection: 'row', gap: 6 }}>
            {week.map((day) => {
              const isDue = day === dueDay;
              const isToday = day === todayDay;
              // The 29th–31st don't exist every month; the app clamps them to the
              // month's last day, so hint that rather than hide them.
              const clamps = day > 28;

              return (
                <View key={day} style={{ flex: 1, aspectRatio: 1 }}>
                  <DayCell
                    day={day}
                    selected={isDue}
                    tint={accent}
                    onPress={onDayPress ? () => onDayPress(day) : undefined}
                    accessibilityLabel={
                      onDayPress
                        ? `Day ${day}${isDue ? ', currently due' : ''}${isToday ? ', today' : ''}`
                        : undefined
                    }
                    restBackground={isToday ? todayTint : colors.surfaceSunken}
                    restColor={isToday ? todayInk : clamps ? colors.inkMuted : colors.inkSecondary}
                  />
                </View>
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

      {/* Says the grid is editable. A calendar reporting a date and a calendar
          setting one look identical at rest, so without this the tap is a
          gesture nobody discovers. */}
      {onDayPress ? (
        <Text variant="caption" tone="muted">
          Tap a day to move this bill.
          {/*
            The 29th–31st do not exist every month. `dueDateFor` clamps them to
            the month's last day, so on a short month the cell that lights up is
            not the cell that was tapped — said here rather than left to look
            like the tap failed.
          */}
          {dueDay > 28 ? ' On shorter months it falls on the last day.' : ''}
        </Text>
      ) : null}
    </View>
  );
}
