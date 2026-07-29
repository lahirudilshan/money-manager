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
