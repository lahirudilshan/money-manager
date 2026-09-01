import { describe, expect, it } from 'vitest';
import { addDays, addMonths } from '../dates';

const at = (iso: string) => new Date(`${iso}T13:45:00`);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('addDays', () => {
  it('moves forward and back', () => {
    expect(iso(addDays(at('2026-09-01'), 7))).toBe('2026-09-08');
    expect(iso(addDays(at('2026-09-01'), -1))).toBe('2026-08-31');
  });

  it('normalises to midnight, so a same-day comparison is not defeated by the clock', () => {
    expect(addDays(at('2026-09-01'), 0).getHours()).toBe(0);
  });

  it('crosses a year boundary', () => {
    expect(iso(addDays(at('2026-12-30'), 5))).toBe('2027-01-04');
  });
});

describe('addMonths', () => {
  it('moves whole months', () => {
    expect(iso(addMonths(at('2026-09-01'), 1))).toBe('2026-10-01');
    expect(iso(addMonths(at('2026-09-15'), 3))).toBe('2026-12-15');
  });

  it('CLAMPS instead of overflowing past the end of a short month', () => {
    /*
     * The trap this exists for. `setMonth` alone turns 31 Jan + 1 month into
     * "31 February", which JavaScript rolls forward into 3 March — a date in a
     * different month from the one the user asked for.
     */
    expect(iso(addMonths(at('2026-01-31'), 1))).toBe('2026-02-28');
    expect(iso(addMonths(at('2026-03-31'), 1))).toBe('2026-04-30');
  });

  it('lands on 29 February in a leap year', () => {
    expect(iso(addMonths(at('2028-01-31'), 1))).toBe('2028-02-29');
  });

  it('crosses a year boundary', () => {
    expect(iso(addMonths(at('2026-11-15'), 3))).toBe('2027-02-15');
  });

  it('normalises to midnight', () => {
    expect(addMonths(at('2026-09-01'), 1).getHours()).toBe(0);
  });
});
