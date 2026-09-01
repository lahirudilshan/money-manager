import { describe, expect, it } from 'vitest';
import {
  buddyTotals,
  daysSince,
  daysUntil,
  dueBuddyLoans,
  isFullyRepaid,
  remainingMinor,
  repaidMinor,
  urgencyOf,
  type BuddyLoanLike,
  type BuddyRepayment,
} from '../buddyLoans';

const d = (iso: string) => new Date(`${iso}T00:00:00`);
const TODAY = d('2026-09-01');

function loan(over: Partial<BuddyLoanLike> = {}): BuddyLoanLike {
  return {
    id: 'l1',
    personName: 'Nuwan',
    amountMinor: 500_000,
    direction: 'lent',
    lentOn: d('2026-08-12'),
    dueOn: d('2026-09-04'),
    status: 'outstanding',
    ...over,
  };
}

const pay = (amountMinor: number, on = '2026-08-20'): BuddyRepayment => ({
  id: `r-${amountMinor}-${on}`,
  amountMinor,
  paidOn: d(on),
});

describe('remainingMinor', () => {
  it('is the full amount before anything comes back', () => {
    expect(remainingMinor(loan(), [])).toBe(500_000);
  });

  it('subtracts part payments', () => {
    expect(remainingMinor(loan(), [pay(200_000)])).toBe(300_000);
  });

  it('never goes negative when they overpay', () => {
    // Rounding up, or paying twice. The lender does not now owe them money.
    expect(remainingMinor(loan(), [pay(600_000)])).toBe(0);
  });

  it('is zero once written off, whatever the arithmetic says', () => {
    expect(remainingMinor(loan({ status: 'written_off' }), [])).toBe(0);
  });
});

describe('isFullyRepaid', () => {
  it('is false while anything is left', () => {
    expect(isFullyRepaid(loan(), [pay(499_900)])).toBe(false);
  });

  it('is true on the exact final payment', () => {
    expect(isFullyRepaid(loan(), [pay(200_000), pay(300_000, '2026-08-28')])).toBe(true);
  });
});

describe('daysUntil', () => {
  it('counts whole days regardless of clock time', () => {
    // The due date is a promise about a DAY, so an evening "today" must not
    // make a debt due tomorrow read as due today.
    const evening = new Date('2026-09-01T23:30:00');
    expect(daysUntil(d('2026-09-04'), evening)).toBe(3);
  });

  it('goes negative once the date has passed', () => {
    expect(daysUntil(d('2026-08-25'), TODAY)).toBe(-7);
  });
});

describe('daysSince', () => {
  it('counts how long ago the money went out', () => {
    // The list showed every loan as lent "today" whatever its date, because
    // the caller had `daysUntil`'s arguments the wrong way round.
    expect(daysSince(d('2026-08-12'), TODAY)).toBe(20);
    expect(daysSince(d('2026-09-01'), TODAY)).toBe(0);
  });

  it('never reports a future date as negative days ago', () => {
    expect(daysSince(d('2026-09-10'), TODAY)).toBe(0);
  });
});

describe('urgencyOf', () => {
  it('bands the same way bill reminders do', () => {
    expect(urgencyOf(-1)).toBe('overdue');
    expect(urgencyOf(0)).toBe('due_soon');
    expect(urgencyOf(7)).toBe('due_soon');
    expect(urgencyOf(8)).toBe('upcoming');
  });
});

describe('dueBuddyLoans — what reaches the dashboard', () => {
  const repayments = new Map<string, BuddyRepayment[]>();

  it('includes an outstanding loan with a due date', () => {
    const out = dueBuddyLoans([loan()], repayments, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(3);
    expect(out[0].urgency).toBe('due_soon');
    expect(out[0].remainingMinor).toBe(500_000);
  });

  it('EXCLUDES a loan with no promised date', () => {
    /*
     * The common case the user described: money handed over with no agreed
     * return date. Inventing one would produce a reminder about a promise
     * nobody made — it stays in the add-on's own list instead.
     */
    expect(dueBuddyLoans([loan({ dueOn: null })], repayments, TODAY)).toEqual([]);
  });

  it('excludes settled and written-off records', () => {
    expect(dueBuddyLoans([loan({ status: 'paid' })], repayments, TODAY)).toEqual([]);
    expect(dueBuddyLoans([loan({ status: 'written_off' })], repayments, TODAY)).toEqual([]);
  });

  it('excludes one fully covered by part payments but not yet ticked', () => {
    const covered = new Map([['l1', [pay(500_000)]]]);
    expect(dueBuddyLoans([loan()], covered, TODAY)).toEqual([]);
  });

  it('reports the REMAINING amount, not the original', () => {
    const partial = new Map([['l1', [pay(200_000)]]]);
    expect(dueBuddyLoans([loan()], partial, TODAY)[0].remainingMinor).toBe(300_000);
  });

  it('includes money the user borrowed, with its direction intact', () => {
    const borrowed = loan({ id: 'b1', direction: 'borrowed' });
    const out = dueBuddyLoans([borrowed], repayments, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].loan.direction).toBe('borrowed');
  });

  it('sorts most overdue first', () => {
    const out = dueBuddyLoans(
      [
        loan({ id: 'soon', dueOn: d('2026-09-04') }),
        loan({ id: 'late', dueOn: d('2026-08-20') }),
        loan({ id: 'later', dueOn: d('2026-10-01') }),
      ],
      repayments,
      TODAY,
    );
    expect(out.map((e) => e.loan.id)).toEqual(['late', 'soon', 'later']);
  });
});

describe('buddyTotals', () => {
  it('keeps written-off money out of both other figures', () => {
    /*
     * The honesty rule. Counting a write-off as repaid overstates what came
     * back; counting it as outstanding keeps chasing something already given
     * up on. It is neither.
     */
    const loans = [
      loan({ id: 'a', amountMinor: 500_000 }),
      loan({ id: 'b', amountMinor: 300_000, status: 'paid' }),
      loan({ id: 'c', amountMinor: 200_000, status: 'written_off' }),
    ];
    const reps = new Map([['b', [pay(300_000)]]]);

    expect(buddyTotals(loans, reps)).toEqual({
      outstandingMinor: 500_000,
      repaidMinor: 300_000,
      writtenOffMinor: 200_000,
      owedByMeMinor: 0,
    });
  });

  it('writes off only the UNRECOVERED remainder', () => {
    // Lent 10,000, got 6,000 back, gave up on the rest: 4,000 is lost, not
    // 10,000 — and the 6,000 really was repaid.
    const loans = [loan({ id: 'a', amountMinor: 1_000_000, status: 'written_off' })];
    const reps = new Map([['a', [pay(600_000)]]]);

    const totals = buddyTotals(loans, reps);
    expect(totals.writtenOffMinor).toBe(400_000);
    expect(totals.repaidMinor).toBe(600_000);
  });

  it('separates money the user owes from money owed to them', () => {
    const loans = [
      loan({ id: 'a', amountMinor: 500_000, direction: 'lent' }),
      loan({ id: 'b', amountMinor: 250_000, direction: 'borrowed' }),
    ];
    const totals = buddyTotals(loans, new Map());
    expect(totals.outstandingMinor).toBe(500_000);
    expect(totals.owedByMeMinor).toBe(250_000);
  });

  it('counts outstanding NET of part payments', () => {
    const loans = [loan({ id: 'a', amountMinor: 500_000 })];
    const reps = new Map([['a', [pay(150_000)]]]);
    expect(buddyTotals(loans, reps).outstandingMinor).toBe(350_000);
  });
});

describe('repaidMinor', () => {
  it('sums every part payment', () => {
    expect(repaidMinor([pay(100_000), pay(50_000, '2026-08-25')])).toBe(150_000);
  });
});
