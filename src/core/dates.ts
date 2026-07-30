/**
 * Calendar-date helpers for transaction dates.
 *
 * Pure and free of any React Native import, so the logic that decides *which
 * month an entry counts toward* is unit-testable — the UI component that
 * renders the picker consumes these rather than reimplementing them.
 *
 * Distinct from `periodKey`/`formatPeriod` in core/planning, which deal in
 * "YYYY-MM" period strings; this file deals in whole days.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export { MONTH_NAMES };

/** Midnight local — strips the time so two dates compare by day alone. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Same calendar day, ignoring the time of day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "Today", "Yesterday", or "24 Jul 2026" — the shortest unambiguous label.
 *
 * Relative wording is used only for the two days people actually think of
 * relatively; anything older is spelled out, since "3 days ago" is harder to
 * check against a bank statement than a real date.
 */
export function formatDateLabel(date: Date, today = new Date()): string {
  if (isSameDay(date, today)) return 'Today';

  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
}

/**
 * Turn the parser's 24-hour "HH:MM" into a 12-hour "8:54 PM".
 *
 * The leading zero is dropped ("8:54 PM", not "08:54 PM") since a 12-hour clock
 * has no column to align and the zero only costs width. Midnight and noon map to
 * 12 rather than 0. A string that is not a clock reading is passed through
 * untouched rather than mangled into something wrong.
 */
export function to12Hour(time: string): string {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return time;

  const hour24 = Number(match[1]);
  if (!Number.isFinite(hour24) || hour24 > 23) return time;

  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return `${hour12}:${match[2]} ${suffix}`;
}

/**
 * The shortest honest "when" for a compact row: "Today 8:54 PM",
 * "22 Jul 8:54 PM", or "22 Jul 2024 8:54 PM".
 *
 * Same relative wording as `formatDateLabel`, but the year is omitted while the
 * date falls in the current year — it carries no information there, and dropping
 * it is what buys room for the clock time on a single line. An older date keeps
 * its year, since that is exactly when the year does matter.
 *
 * Takes the ISO date string the SMS parser produces (and its separate 24-hour
 * "HH:MM", rendered here as 12-hour), either of which may be null; returns ''
 * when there is nothing to show.
 */
export function shortWhen(
  isoDate: string | null,
  time: string | null,
  today = new Date(),
): string {
  const clock = time ? to12Hour(time) : '';
  if (!isoDate) return clock;

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return clock;

  const day = isSameDay(date, today)
    ? 'Today'
    : isSameDay(date, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
      ? 'Yesterday'
      : date.getFullYear() === today.getFullYear()
        ? `${date.getDate()} ${MONTH_NAMES[date.getMonth()].slice(0, 3)}`
        : `${date.getDate()} ${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;

  return clock ? `${day} ${clock}` : day;
}

/**
 * The cells of a month grid: leading blanks so the 1st lands on its weekday,
 * then each day of the month. Nulls render as empty spacers.
 */
export function monthGrid(year: number, month: number): (number | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
}
