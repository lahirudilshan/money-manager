import { describe, expect, it } from 'vitest';
import {
  buddyTotals,
  daysSince,
  dueBuddyLoans,
  isFullyRepaid,
  remainingMinor,
  repaidMinor,
  type BuddyLoanLike,
  type BuddyRepayment,
} from '../buddyLoans';

/**
 * Situations that actually happen when you lend money to people.
 *
 * The existing suite covers the arithmetic; this one walks through whole
 * stories the way a user lives them, because the interesting failures are in
 * the SEQUENCE — a debt part paid then written off, a repayment deleted after
 * it settled a loan, the same person owing twice.
 */

const day = (offset: number) => {
  const d = new Date('2026-09-01T12:00:00');
  d.setDate(d.getDate() + offset);
  return d;
};
const TODAY = new Date('2026-09-01T12:00:00');

const loan = (over: Partial<BuddyLoanLike> = {}): BuddyLoanLike => ({
  id: 'l1',
  personName: 'Nuwan',
  amountMinor: 500_000,
  direction: 'lent',
  lentOn: day(-20),
  dueOn: day(3),
  status: 'outstanding',
  ...over,
});

const pay = (id: string, amountMinor: number, offset: number): BuddyRepayment => ({
  id,
  amountMinor,
  paidOn: day(offset),
});

describe('they pay you back in dribs and drabs', () => {
  it('tracks the balance down across several small payments', () => {
    const l = loan({ amountMinor: 1_000_000 });
    const parts = [pay('a', 200_000, -15), pay('b', 150_000, -10), pay('c', 100_000, -3)];

    expect(repaidMinor(parts)).toBe(450_000);
    expect(remainingMinor(l, parts)).toBe(550_000);
    expect(isFullyRepaid(l, parts)).toBe(false);
  });

  it('settles on the payment that finally covers it', () => {
    const l = loan({ amountMinor: 1_000_000 });
    const parts = [pay('a', 200_000, -15), pay('b', 800_000, -1)];

    expect(isFullyRepaid(l, parts)).toBe(true);
    expect(remainingMinor(l, parts)).toBe(0);
  });

  it('a settled loan leaves the dashboard even before it is ticked', () => {
    // The row is covered but still marked outstanding — nothing to chase, so
    // it must not keep nagging while the user gets round to closing it.
    const covered = new Map([['l1', [pay('a', 500_000, -1)]]]);
    expect(dueBuddyLoans([loan()], covered, TODAY)).toEqual([]);
  });
});

describe('they pay back MORE than they owed', () => {
  it('rounds up without the lender appearing to owe them', () => {
    // Lent 4,850; they hand over 5,000 and say keep it.
    const l = loan({ amountMinor: 485_000 });
    const parts = [pay('a', 500_000, -1)];

    expect(remainingMinor(l, parts)).toBe(0);
    expect(isFullyRepaid(l, parts)).toBe(true);
  });

  it('does not let the overpayment flatter the outstanding total', () => {
    const totals = buddyTotals([loan({ amountMinor: 485_000 })], new Map([['l1', [pay('a', 500_000, -1)]]]));
    expect(totals.outstandingMinor).toBe(0);
  });
});

describe('they pay some, then stop answering', () => {
  it('writes off only what never came back', () => {
    // Lent 10,000, got 4,000, gave up. The 4,000 really was repaid.
    const l = loan({ amountMinor: 1_000_000, status: 'written_off' });
    const parts = new Map([['l1', [pay('a', 400_000, -60)]]]);

    const totals = buddyTotals([l], parts);
    expect(totals.writtenOffMinor).toBe(600_000);
    expect(totals.repaidMinor).toBe(400_000);
    expect(totals.outstandingMinor).toBe(0);
  });

  it('stops chasing a written-off debt', () => {
    const l = loan({ status: 'written_off', dueOn: day(-30) });
    expect(dueBuddyLoans([l], new Map(), TODAY)).toEqual([]);
  });

  it('never reports a negative write-off when they overpaid first', () => {
    // Defensive: a write-off recorded after the debt was already covered.
    const l = loan({ amountMinor: 300_000, status: 'written_off' });
    const parts = new Map([['l1', [pay('a', 400_000, -10)]]]);
    expect(buddyTotals([l], parts).writtenOffMinor).toBe(0);
  });
});

describe('one person, several separate loans', () => {
  it('keeps them apart rather than merging into one debt', () => {
    /*
     * The same friend borrowing twice is two promises with two dates, not one
     * running tab — settling the first must not touch the second.
     */
    const loans = [
      loan({ id: 'a', amountMinor: 500_000, dueOn: day(2) }),
      loan({ id: 'b', amountMinor: 300_000, dueOn: day(20) }),
    ];
    const parts = new Map([['a', [pay('p', 500_000, -1)]]]);

    const due = dueBuddyLoans(loans, parts, TODAY);
    expect(due).toHaveLength(1);
    expect(due[0].loan.id).toBe('b');
    expect(buddyTotals(loans, parts).outstandingMinor).toBe(300_000);
  });
});

describe('money going both ways with the same person', () => {
  it('never nets a debt against a loan', () => {
    /*
     * You lent Ruwan 5,000 and later borrowed 2,000 from him. These are two
     * separate promises — quietly netting them to "owes you 3,000" would
     * invent an agreement neither of you made.
     */
    const loans = [
      loan({ id: 'out', amountMinor: 500_000, direction: 'lent' }),
      loan({ id: 'in', amountMinor: 200_000, direction: 'borrowed' }),
    ];

    const totals = buddyTotals(loans, new Map());
    expect(totals.outstandingMinor).toBe(500_000);
    expect(totals.owedByMeMinor).toBe(200_000);
  });
});

describe('dates people actually use', () => {
  it('counts a loan due today as due, not late', () => {
    const due = dueBuddyLoans([loan({ dueOn: day(0) })], new Map(), TODAY);
    expect(due[0].urgency).toBe('due_soon');
    expect(due[0].daysUntil).toBe(0);
  });

  it('is not fooled by the time of day', () => {
    // Logged at 11pm, due tomorrow morning: still 1 day, not 0.
    const lateEvening = new Date('2026-09-01T23:50:00');
    const due = dueBuddyLoans([loan({ dueOn: day(1) })], new Map(), lateEvening);
    expect(due[0].daysUntil).toBe(1);
  });

  it('handles a loan lent and due on the same day', () => {
    const l = loan({ lentOn: day(0), dueOn: day(0) });
    expect(daysSince(l.lentOn, TODAY)).toBe(0);
    expect(dueBuddyLoans([l], new Map(), TODAY)[0].urgency).toBe('due_soon');
  });

  it('keeps a long-forgotten debt in the totals but ranks it by lateness', () => {
    const ancient = loan({ id: 'old', amountMinor: 200_000, lentOn: day(-400), dueOn: day(-365) });
    const recent = loan({ id: 'new', amountMinor: 100_000, dueOn: day(-2) });

    const due = dueBuddyLoans([recent, ancient], new Map(), TODAY);
    expect(due.map((e) => e.loan.id)).toEqual(['old', 'new']);
    expect(daysSince(ancient.lentOn, TODAY)).toBe(400);
  });
});

describe('the money itself', () => {
  it('handles a very large loan without losing precision', () => {
    // 2,500,000.00 — a serious sum between family.
    const l = loan({ amountMinor: 250_000_000 });
    const parts = [pay('a', 100_000_050, -5)];
    expect(remainingMinor(l, parts)).toBe(149_999_950);
  });

  it('handles cents, since a transfer fee makes amounts uneven', () => {
    const l = loan({ amountMinor: 1_000_25 });
    expect(remainingMinor(l, [pay('a', 25, -1)])).toBe(1_000_00);
  });
});

describe('an empty book', () => {
  it('totals to zero rather than NaN', () => {
    expect(buddyTotals([], new Map())).toEqual({
      outstandingMinor: 0,
      repaidMinor: 0,
      writtenOffMinor: 0,
      owedByMeMinor: 0,
    });
  });

  it('puts nothing on the dashboard', () => {
    expect(dueBuddyLoans([], new Map(), TODAY)).toEqual([]);
  });
});
