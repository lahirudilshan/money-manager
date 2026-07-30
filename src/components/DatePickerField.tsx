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
import { DayCell } from './DayCell';
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
  // The two dates people actually reach for when logging an entry late.
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

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
        eyebrow={label}
        icon="calendar-outline"
        iconColor={colors.accent}
        // Shortcuts pinned at the bottom, where the thumb already is, rather
        // than floating under the grid as a bare text link.
        footer={
          <Row gap={space.sm}>
            <QuickDate
              label="Today"
              active={isSameDay(value, today)}
              onPress={() => {
                onChange(today);
                setOpen(false);
              }}
            />
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
          </Row>
        }
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          {/* The date being chosen, echoed in full. The sheet is opened from a row
              that may scroll out of view, so the current value is restated rather
              than left to memory — and it gives the month nav a visible anchor. */}
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
            <T variant="small" color={colors.accentInk} style={{ fontWeight: '700' }}>
              {formatDateLabel(value)}
            </T>
            <T variant="caption" color={colors.accentInk} style={{ flex: 1, opacity: 0.75 }}>
              {value.getDate()} {MONTH_NAMES[value.getMonth()]} {value.getFullYear()}
            </T>
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
                  <T variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                    {day}
                  </T>
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
      <T
        variant="small"
        color={active ? colors.accentInk : colors.inkSecondary}
        style={{ fontWeight: '700' }}
      >
        {label}
      </T>
    </Pressable>
  );
}
