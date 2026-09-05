import { describe, expect, it } from 'vitest';
import { isObligationMet } from '../planning';

/**
 * When a line's monthly obligation is done.
 *
 * The board holds two kinds, and only one of them has a tick. A dated bill is
 * settled by being marked paid; an ongoing line with a monthly budget has no
 * such moment — it is done when spending reaches the budget. Captured from the
 * user's board: a LKR 10,000 monthly transfer to Kelaniya, logged in full, was
 * still counted alongside genuinely unpaid bills.
 */

const ongoing = (plannedMinor: number, actualMinor: number | null) => ({
  frequency: 'ongoing' as const,
  status: 'pending' as const,
  plannedMinor,
  actualMinor,
});

describe('a dated bill', () => {
  it('is met once ticked paid', () => {
    expect(
      isObligationMet({ frequency: 'monthly', status: 'paid', plannedMinor: 35_000_00 }),
    ).toBe(true);
  });

  it('is not met while pending, however much was logged', () => {
    expect(
      isObligationMet({
        frequency: 'monthly',
        status: 'pending',
        plannedMinor: 35_000_00,
        actualMinor: 35_000_00,
      }),
    ).toBe(false);
  });

  /** A line with no frequency is monthly, the historic default. */
  it('treats an absent frequency as a dated bill', () => {
    expect(isObligationMet({ status: 'paid', plannedMinor: 100 })).toBe(true);
  });
});

describe('an ongoing line with a budget', () => {
  it('is met once spending reaches the budget', () => {
    expect(isObligationMet(ongoing(10_000_00, 10_000_00))).toBe(true);
  });

  /** Over budget is still met — the money has left, it is not unfinished. */
  it('is met when spending exceeds the budget', () => {
    expect(isObligationMet(ongoing(10_000_00, 12_500_00))).toBe(true);
  });

  it('is not met while spending is short', () => {
    expect(isObligationMet(ongoing(10_000_00, 9_999_00))).toBe(false);
  });

  it('is not met with nothing logged', () => {
    expect(isObligationMet(ongoing(10_000_00, 0))).toBe(false);
    expect(isObligationMet(ongoing(10_000_00, null))).toBe(false);
  });
});

describe('an ongoing line with NO budget', () => {
  /**
   * There is no figure to reach, so "done" has no meaning — claiming otherwise
   * would mark every open-ended budget complete on its first receipt.
   */
  it('is never met, however much is spent', () => {
    expect(isObligationMet(ongoing(0, 50_000_00))).toBe(false);
    expect(isObligationMet(ongoing(0, 0))).toBe(false);
  });
});
