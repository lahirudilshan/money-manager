import { describe, expect, it } from 'vitest';
import { buddyTotals, dueBuddyLoans, type BuddyLoanLike, type BuddyRepayment } from '../buddyLoans';
import { describeDue } from '../format';

/**
 * The seeded simulator board, asserted end to end.
 *
 * Six records covering every state the add-on can be in, so the dashboard's
 * merged "Coming up" list and the book's own totals are both pinned to a
 * concrete arrangement rather than to one happy-path row.
 */
const day = (offset: number) => {
  const d = new Date('2026-09-01T12:00:00');
  d.setDate(d.getDate() + offset);
  return d;
};
const TODAY = new Date('2026-09-01T12:00:00');

const LOANS: BuddyLoanLike[] = [
  { id: 'bl1', personName: 'Nuwan', amountMinor: 500_000, direction: 'lent', lentOn: day(-20), dueOn: day(3), status: 'outstanding' },
  { id: 'bl2', personName: 'Kasun', amountMinor: 1_500_000, direction: 'lent', lentOn: day(-45), dueOn: day(-9), status: 'outstanding' },
  { id: 'bl3', personName: 'Amma', amountMinor: 300_000, direction: 'lent', lentOn: day(-12), dueOn: null, status: 'outstanding' },
  { id: 'bl4', personName: 'Sanjeewa', amountMinor: 1_000_000, direction: 'lent', lentOn: day(-120), dueOn: day(-60), status: 'written_off' },
  { id: 'bl5', personName: 'Dilan', amountMinor: 200_000, direction: 'lent', lentOn: day(-60), dueOn: day(-30), status: 'paid' },
  { id: 'bl6', personName: 'Ruwan', amountMinor: 750_000, direction: 'borrowed', lentOn: day(-10), dueOn: day(12), status: 'outstanding' },
];

const REPAYMENTS = new Map<string, BuddyRepayment[]>([
  ['bl2', [{ id: 'br1', amountMinor: 600_000, paidOn: day(-20) }]],
  ['bl5', [{ id: 'br2', amountMinor: 200_000, paidOn: day(-30) }]],
  ['bl4', [{ id: 'br3', amountMinor: 400_000, paidOn: day(-90) }]],
]);

describe('the seeded board', () => {
  it('puts exactly three debts on the dashboard, most overdue first', () => {
    const due = dueBuddyLoans(LOANS, REPAYMENTS, TODAY);

    // Amma (no date), Dilan (settled) and Sanjeewa (written off) are all out.
    expect(due.map((e) => e.loan.personName)).toEqual(['Kasun', 'Nuwan', 'Ruwan']);
  });

  it('shows Kasun owing the REMAINDER after his part payment', () => {
    const due = dueBuddyLoans(LOANS, REPAYMENTS, TODAY);
    const kasun = due.find((e) => e.loan.personName === 'Kasun')!;

    // Lent 15,000, paid back 6,000 — the row must ask for 9,000, not 15,000.
    expect(kasun.remainingMinor).toBe(900_000);
    expect(kasun.urgency).toBe('overdue');
    expect(describeDue(kasun.daysUntil)).toBe('9 days late');
  });

  it('words the near-term rows the way a person would', () => {
    const due = dueBuddyLoans(LOANS, REPAYMENTS, TODAY);
    expect(describeDue(due.find((e) => e.loan.personName === 'Nuwan')!.daysUntil)).toBe('due in 3 days');
    expect(describeDue(due.find((e) => e.loan.personName === 'Ruwan')!.daysUntil)).toBe('due in 12 days');
  });

  it('totals the book honestly', () => {
    /*
     * Owed to the user: Nuwan 5,000 + Kasun's remaining 9,000 + Amma's 3,000
     * = 17,000.
     *
     * Amma's is counted even though it carries no due date and never reaches
     * the dashboard. The two questions are different: "what should I be
     * reminded about" excludes it, "how much am I owed" must not — money with
     * no agreed return date is still owed, and leaving it out of the headline
     * would understate the book by exactly the loans most at risk of being
     * forgotten.
     *
     * Ruwan's 7,500 is money the USER owes and is reported separately.
     * Sanjeewa: lent 10,000, recovered 4,000, so 6,000 is written off — the
     * 4,000 still counts as having come back.
     */
    expect(buddyTotals(LOANS, REPAYMENTS)).toEqual({
      outstandingMinor: 1_700_000,
      repaidMinor: 1_200_000,
      writtenOffMinor: 600_000,
      owedByMeMinor: 750_000,
    });
  });
});
