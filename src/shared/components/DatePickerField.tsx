import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import {
  addDays,
  addMonths,
  formatDateLabel,
  isSameDay,
  MONTH_NAMES,
  monthGrid,
  startOfDay,
} from '~/shared/lib/dates';
import { useTheme } from '../theme/ThemeProvider';
import { DayCell } from '~/features/budget/components/DayCell';
import { BottomSheet, Label, Row, Text } from './ui';

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

/** Stands in for "no upper bound" on a future-facing field. */
const MAX_FUTURE = new Date(9999, 11, 31);

export function DatePickerField({
  label = 'Date',
  value,
  onChange,
  /** Latest selectable day. Defaults to today — a transaction cannot be future. */
  maximumDate,
  /**
   * Let the user pick a date in the FUTURE.
   *
   * An explicit flag rather than `maximumDate={undefined}`, which reads as "no
   * limit" and does the opposite: the default is today, so passing undefined
   * silently clamped a repayment-date field to the past and the grid refused
   * every day the field existed to choose. A boolean cannot be misread that
   * way, and it is what swaps the footer shortcuts to Yesterday/Today or
   * 1 week / 2 weeks / 1 month.
   */
  allowFuture = false,
}: {
  label?: string;
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
  allowFuture?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = React.useState(false);
  // Which month the grid is showing; re-anchored to the value on each open so
  // reopening never strands the user in a month they browsed away to.
  const [cursor, setCursor] = React.useState(() => startOfDay(value));

  const today = startOfDay(new Date());
  /*
   * A forward-looking field has no ceiling unless the caller names one — you
   * can promise to repay in a year. `MAX_FUTURE` stands in for "no limit" so
   * the comparison below stays a plain date test.
   */
  const max = startOfDay(maximumDate ?? (allowFuture ? MAX_FUTURE : today));
  // The two dates people actually reach for when logging an entry late.
  const yesterday = addDays(today, -1);

  /*
   * Which way this field points, and therefore which shortcuts help.
   *
   * Nearly every date in the app is something that ALREADY happened — a
   * transaction, a fill-up, a doctor's visit — so the shortcuts are Yesterday
   * and Today. A repayment date is the exception: it is a promise about the
   * future, and offering "Yesterday" there is offering a date the field's own
   * rules would reject.
   *
   * Inferred from `maximumDate` rather than asking the caller for another flag:
   * a field that permits future dates passes `undefined` (or a date beyond
   * today), and that IS the statement that this one looks forward. The two can
   * never fall out of step because they are the same fact.
   */
  const looksForward = allowFuture || max > today;
  const inAWeek = addDays(today, 7);
  const inAMonth = addMonths(today, 1);

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
  /*
   * Whether the headline reads as a WORD rather than a date.
   *
   * Derived from the same two days `formatDateLabel` special-cases, rather than
   * string-matching its output — the two can then never disagree about what
   * counts as relative.
   */
  const isRelativeLabel = isToday || isSameDay(value, yesterday);


  return (
    <View style={{ gap: space.sm }}>
      {/* An empty label renders nothing, so a caller that has already headed
          the field itself does not get a blank line of space above it. */}
      {label ? <Label>{label.toUpperCase()}</Label> : null}

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
        <Text variant="body" style={{ flex: 1, fontWeight: '600' }}>
          {formatDateLabel(value)}
        </Text>
        {/* The exact date alongside "Today" so the relative label is never the
            only information — useful when logging several days at once. */}
        {isToday ? (
          <Text variant="caption" tone="muted">
            {value.getDate()} {MONTH_NAMES[value.getMonth()].slice(0, 3)}
          </Text>
        ) : null}
        <Ionicons name="chevron-down" size={15} color={colors.inkMuted} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Pick a date"
        eyebrow={label}
        icon="calendar-outline"
        iconColor={colors.accent}
        /*
         * Shortcuts pinned at the foot of the sheet, where the thumb already
         * is, rather than floating under the grid as a bare text link.
         *
         * Yesterday leads, Today sits on the right.
         *
         * Right is the near side for a thumb on a phone held in either hand,
         * and "Today" is by far the more common choice — it is the default the
         * field already holds, and the one someone taps when they opened the
         * picker only to confirm. Putting the likelier action where the thumb
         * already rests, and the rarer one further away, is the ordering every
         * other confirm-style row in the app uses.
         */
        footer={
          <Row gap={space.sm}>
            {looksForward ? (
              <>
                {/*
                  Forward shortcuts, for a field asking when something is DUE.

                  Worded "In 1 week" rather than "1 week": a bare duration
                  beside Yesterday/Today reads as a length of time, not a date,
                  and these buttons SET a date. The preposition is what makes
                  them answer the question the field asked.

                  Ordered nearest-first, left to right, so the row reads as a
                  scale rather than an unordered set — and the furthest option
                  sits nearest the thumb, since "next month" is the commonest
                  informal promise.
                */}
                <QuickDate
                  label="In 1 week"
                  active={isSameDay(value, inAWeek)}
                  onPress={() => {
                    onChange(inAWeek);
                    setOpen(false);
                  }}
                />
                <QuickDate
                  label="In 2 weeks"
                  active={isSameDay(value, addDays(today, 14))}
                  onPress={() => {
                    onChange(addDays(today, 14));
                    setOpen(false);
                  }}
                />
                <QuickDate
                  label="In 1 month"
                  active={isSameDay(value, inAMonth)}
                  onPress={() => {
                    onChange(inAMonth);
                    setOpen(false);
                  }}
                />
              </>
            ) : (
              <>
                <QuickDate
                  label="Yesterday"
                  active={isSameDay(value, yesterday)}
                  // Guarded: with a maximumDate in the past, yesterday may be out of
                  // range, and the shortcut must not set a date the grid forbids.
                  disabled={yesterday > max}
                  onPress={() => {
                    onChange(yesterday);
                    setOpen(false);
                  }}
                />
                <QuickDate
                  label="Today"
                  active={isSameDay(value, today)}
                  onPress={() => {
                    onChange(today);
                    setOpen(false);
                  }}
                />
              </>
            )}
          </Row>
        }
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          {/*
            The date being chosen, echoed in full.

            The sheet is opened from a row that may scroll out of view, so the
            current value is restated rather than left to memory — and it gives
            the month nav a visible anchor.
          */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              backgroundColor: colors.accentSoft,
            }}
          >
            <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
            <Text
              variant="small"
              color={colors.accentInk}
              style={{ flex: 1, fontWeight: '700' }}
            >
              {formatDateLabel(value)}
            </Text>
            {/*
              The spelled-out date, ONLY beside a relative label.

              `formatDateLabel` returns "Today"/"Yesterday" for those two days
              and the full date for every other, so printing this unconditionally
              stated the same date twice — "4 Sep 2026   4 September 2026". It
              exists to say WHICH day "Today" is, and has nothing to add once the
              label is already a date.
            */}
            {isRelativeLabel ? (
              <Text variant="caption" color={colors.accentInk} style={{ opacity: 0.75 }}>
                {value.getDate()} {MONTH_NAMES[value.getMonth()]} {value.getFullYear()}
              </Text>
            ) : null}
          </View>

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
            <Text variant="bodyStrong">
              {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
            </Text>
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

          {/* The grid sits on a sunken panel so the month reads as one object and
              the selected day has something to sit against. */}
          <View
            style={{
              borderRadius: radius.md,
              backgroundColor: colors.surfaceSunken,
              padding: space.sm,
              gap: 2,
            }}
          >
            <Row gap={0}>
              {WEEKDAYS.map((day, index) => (
                <View key={`${day}-${index}`} style={{ flex: 1, alignItems: 'center', paddingBottom: 4 }}>
                  <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                    {day}
                  </Text>
                </View>
              ))}
            </Row>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((day, index) => {
                if (day === null) {
                  return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 42 }} />;
                }

                const cellDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);
                const selected = isSameDay(cellDate, value);
                const marksToday = isSameDay(cellDate, today);
                const disabled = cellDate > max;

                return (
                  <View key={day} style={{ width: `${100 / 7}%`, height: 42, padding: 2 }}>
                    <DayCell
                      day={day}
                      selected={selected}
                      marksToday={marksToday}
                      disabled={disabled}
                      onPress={() => select(day)}
                      // Against the sunken panel a transparent rest state would
                      // leave the days looking unclickable, so each sits on the
                      // surface colour.
                      restBackground={colors.surface}
                      accessibilityLabel={`${day} ${MONTH_NAMES[cursor.getMonth()]}`}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

/**
 * A month arrow, as a tappable tile rather than a bare glyph — the old 20px icon
 * was a small target for the control users reach for most in this sheet.
 */
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
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        borderWidth: 1,
        borderColor: colors.hairline,
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={disabled ? colors.inkMuted : colors.ink} />
    </Pressable>
  );
}

/**
 * A "Today"/"Yesterday" shortcut in the sheet's footer.
 *
 * Highlighted when it already matches the value, so the footer doubles as a
 * readout of whether the current pick is one of the two common cases.
 */
function QuickDate({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.hairlineStrong,
        backgroundColor: pressed ? colors.surfaceSunken : active ? colors.accentSoft : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Text
        variant="small"
        color={active ? colors.accentInk : colors.inkSecondary}
        style={{ fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
