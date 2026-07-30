import { describe, expect, it } from 'vitest';
import { formatDateLabel, monthGrid, shortWhen, to12Hour } from '../dates';
import { periodKey } from '../planning';

/**
 * The date on a transaction decides which month it counts toward, so the label
 * has to be unambiguous and the period derived from it must follow the date —
 * not the month that happens to be on screen.
 */
describe('formatDateLabel', () => {
  const today = new Date(2026, 6, 29); // 29 Jul 2026

  it('names today as Today', () => {
    expect(formatDateLabel(new Date(2026, 6, 29), today)).toBe('Today');
  });

  it('names the previous day as Yesterday', () => {
    expect(formatDateLabel(new Date(2026, 6, 28), today)).toBe('Yesterday');
  });

  it('spells out any other date', () => {
    expect(formatDateLabel(new Date(2026, 5, 14), today)).toBe('14 Jun 2026');
  });

  it('handles yesterday across a month boundary', () => {
    const firstOfJuly = new Date(2026, 6, 1);
    expect(formatDateLabel(new Date(2026, 5, 30), firstOfJuly)).toBe('Yesterday');
  });

  it('handles yesterday across a year boundary', () => {
    const newYear = new Date(2026, 0, 1);
    expect(formatDateLabel(new Date(2025, 11, 31), newYear)).toBe('Yesterday');
  });

  it('ignores the time of day when comparing', () => {
    const morning = new Date(2026, 6, 29, 8, 30);
    const evening = new Date(2026, 6, 29, 22, 15);
    expect(formatDateLabel(morning, evening)).toBe('Today');
  });
});

/** Banks send 24-hour times; the UI shows the 12-hour clock people read. */
describe('to12Hour', () => {
  it('converts an evening time', () => {
    expect(to12Hour('20:54')).toBe('8:54 PM');
  });

  it('keeps morning times in AM and drops the leading zero', () => {
    expect(to12Hour('09:05')).toBe('9:05 AM');
    expect(to12Hour('11:59')).toBe('11:59 AM');
  });

  it('maps midnight and noon to 12, not 0', () => {
    expect(to12Hour('00:30')).toBe('12:30 AM');
    expect(to12Hour('12:00')).toBe('12:00 PM');
  });

  it('treats 12:59 as PM and 13:00 as 1 PM', () => {
    expect(to12Hour('12:59')).toBe('12:59 PM');
    expect(to12Hour('13:00')).toBe('1:00 PM');
  });

  it('passes through anything that is not a clock reading', () => {
    expect(to12Hour('not-a-time')).toBe('not-a-time');
    expect(to12Hour('99:00')).toBe('99:00');
  });
});

/**
 * The compact SMS draft card shows date and time on its provenance line, so the
 * label has to stay short without ever becoming ambiguous — the year is dropped
 * only where it is implied.
 */
describe('shortWhen', () => {
  const today = new Date(2026, 6, 29); // 29 Jul 2026

  it('appends a 12-hour time to a relative day', () => {
    expect(shortWhen('2026-07-29', '20:54', today)).toBe('Today 8:54 PM');
    expect(shortWhen('2026-07-28', '09:05', today)).toBe('Yesterday 9:05 AM');
  });

  it('omits the year within the current year', () => {
    expect(shortWhen('2026-07-22', '20:54', today)).toBe('22 Jul 8:54 PM');
  });

  it('keeps the year for an earlier year, where it carries meaning', () => {
    expect(shortWhen('2024-11-03', '18:30', today)).toBe('3 Nov 2024 6:30 PM');
  });

  it('shows the date alone when the message carried no time', () => {
    expect(shortWhen('2026-07-22', null, today)).toBe('22 Jul');
    expect(shortWhen('2024-11-03', null, today)).toBe('3 Nov 2024');
  });

  it('falls back to the bare time when there is no date', () => {
    expect(shortWhen(null, '20:54', today)).toBe('8:54 PM');
  });

  it('returns an empty string when the message carried neither', () => {
    expect(shortWhen(null, null, today)).toBe('');
  });

  it('does not crash on a malformed date string', () => {
    expect(shortWhen('not-a-date', '20:54', today)).toBe('8:54 PM');
  });
});

describe('the chosen date decides the period', () => {
  it('files a back-dated entry under the month it happened', () => {
    expect(periodKey(new Date(2026, 5, 14))).toBe('2026-06');
  });

  it('files a same-month entry under the current month', () => {
    expect(periodKey(new Date(2026, 6, 29))).toBe('2026-07');
  });

  it('pads single-digit months', () => {
    expect(periodKey(new Date(2026, 0, 5))).toBe('2026-01');
  });
});

/** The calendar grid must line the 1st up under its real weekday. */
describe('monthGrid', () => {
  it('pads so the 1st falls on its weekday', () => {
    // 1 Jul 2026 is a Wednesday -> three leading blanks (Sun, Mon, Tue).
    const cells = monthGrid(2026, 6);
    expect(cells.slice(0, 4)).toEqual([null, null, null, 1]);
  });

  it('covers every day of the month', () => {
    expect(monthGrid(2026, 6).filter((c) => c !== null)).toHaveLength(31);
  });

  it('handles a 30-day month', () => {
    expect(monthGrid(2026, 5).filter((c) => c !== null)).toHaveLength(30);
  });

  it('handles February in a leap year', () => {
    expect(monthGrid(2028, 1).filter((c) => c !== null)).toHaveLength(29);
  });

  it('handles February in a common year', () => {
    expect(monthGrid(2026, 1).filter((c) => c !== null)).toHaveLength(28);
  });
});
