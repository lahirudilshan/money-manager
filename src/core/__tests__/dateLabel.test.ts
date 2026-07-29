import { describe, expect, it } from 'vitest';
import { formatDateLabel, monthGrid } from '../dates';
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
