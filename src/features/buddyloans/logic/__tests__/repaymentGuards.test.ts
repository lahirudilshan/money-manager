import { describe, expect, it } from 'vitest';
import { validateRepayment, validateLoanAmount } from '../buddyLoans';

/**
 * Two guards the screens were missing, both found by walking real situations
 * rather than by re-reading the arithmetic.
 *
 * Neither corrupts a total — `remainingMinor` clamps at zero — but both let the
 * stored history say something that did not happen, which is worse in a book
 * whose whole purpose is remembering who paid what.
 */

describe('validateRepayment', () => {
  it('accepts a part payment', () => {
    expect(validateRepayment(200_000, 500_000)).toBeNull();
  });

  it('accepts the exact remaining balance', () => {
    expect(validateRepayment(500_000, 500_000)).toBeNull();
  });

  it('REJECTS more than is owed', () => {
    /*
     * Typing 50,000 where 5,000 was owed is a slipped digit, not a gift. The
     * balance clamps to zero either way, so nothing looks wrong afterwards —
     * the repayment list just quietly claims they paid ten times what they
     * borrowed.
     */
    expect(validateRepayment(5_000_000, 500_000)).toBe('That is more than they still owe');
  });

  it('rejects zero and negative amounts', () => {
    expect(validateRepayment(0, 500_000)).toBe('Enter an amount');
    expect(validateRepayment(-100, 500_000)).toBe('Enter an amount');
  });

  it('allows a small overpayment for rounding', () => {
    // They owe 4,850 and hand over 5,000 saying keep the change. Common, and
    // not a mistake — so the guard only fires on a clear slip, not on tidying.
    expect(validateRepayment(500_000, 485_000)).toBeNull();
  });

  it('still rejects a slipped digit even inside the rounding allowance', () => {
    // 10x is never rounding, however small the original.
    expect(validateRepayment(1_000_000, 100_000)).toBe('That is more than they still owe');
  });
});

describe('validateLoanAmount', () => {
  it('accepts an amount at or above what has been repaid', () => {
    expect(validateLoanAmount(500_000, 200_000)).toBeNull();
    expect(validateLoanAmount(200_000, 200_000)).toBeNull();
  });

  it('REJECTS editing the loan below what has already come back', () => {
    /*
     * Correcting "I lent 10,000" down to 3,000 after 6,000 has been logged
     * leaves a record where they repaid twice what they borrowed. The edit is
     * usually right and the repayment wrong — but the app must say so rather
     * than store the contradiction.
     */
    expect(validateLoanAmount(300_000, 600_000)).toBe('They have already paid back more than this');
  });

  it('is unbothered when nothing has been repaid', () => {
    expect(validateLoanAmount(100, 0)).toBeNull();
  });
});
