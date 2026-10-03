import { describe, expect, it } from 'vitest';
import { draftDate } from '~/features/sms/logic/smsCategoryHints';
import { periodKey } from '~/features/budget/logic/planning';

/**
 * Which date a confirmed SMS is logged under.
 *
 * The parser finds a date in most messages but not all, and the fallback used
 * to be silent: an undated alert logged as "now" with nothing on screen saying
 * so. The confirm sheet now shows this in a picker, which only works if the
 * seed is always a valid, sensible date.
 */
describe('draftDate', () => {
  const now = new Date(2026, 9, 4, 12, 0, 0);

  it('uses the date the message carried', () => {
    const parsed = draftDate('2026-09-25', now);
    expect(periodKey(parsed)).toBe('2026-09');
  });

  it('falls back to today when the message had none', () => {
    expect(draftDate(null, now)).toBe(now);
    expect(draftDate(undefined, now)).toBe(now);
    expect(draftDate('', now)).toBe(now);
  });

  /*
   * `new Date('not a date')` is an Invalid Date: it renders as "Invalid Date"
   * in the picker and writes NaN into the row. Falling back to today is a far
   * better wrong answer than that.
   */
  it('falls back rather than producing an Invalid Date', () => {
    const result = draftDate('not a date', now);
    expect(Number.isNaN(result.getTime())).toBe(false);
    expect(result).toBe(now);
  });

  /*
   * A two-digit year read the wrong way round, or a device clock behind the
   * bank's, can date a payment in the future — which lands it in a period the
   * board is not showing, so the entry looks like it never saved.
   */
  it('does not trust a future date', () => {
    expect(draftDate('2027-01-01', now)).toBe(now);
  });

  it('accepts a date from today itself', () => {
    const earlierToday = new Date(2026, 9, 4, 9, 0, 0);
    expect(draftDate(earlierToday.toISOString(), now)).toEqual(earlierToday);
  });
});

/**
 * The month a confirmation counts toward.
 *
 * Three branches in `confirmDraft` record a payment — a split, an accumulating
 * line, and a dated bill. All three now derive their month from the payment's
 * date. The third used to use the month the user was BROWSING, so confirming
 * a payment from the 28th while looking at next month settled the wrong one.
 */
describe('the period follows the payment, not the browsed month', () => {
  it('derives the month from the confirmed date', () => {
    expect(periodKey(draftDate('2026-09-25', new Date(2026, 9, 4)))).toBe('2026-09');
  });

  it('puts an undated message in the month it is confirmed', () => {
    const now = new Date(2026, 9, 4);
    expect(periodKey(draftDate(null, now))).toBe('2026-10');
  });
});
