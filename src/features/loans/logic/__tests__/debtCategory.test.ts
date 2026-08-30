import { describe, expect, it } from 'vitest';
import { calculateRatios, isSpend, monthlyAmount } from '~/features/budget/logic/planning';
import { toMinor } from '~/shared/lib/money';

/**
 * Every loan lives as a line under one shared "Debt" category, so the
 * loans-vs-living split must be decided per *line* (does it carry a loanId?)
 * rather than per category. A category-level test would bucket anything else
 * filed under Debt as debt, and previously bucketed a whole mixed category as
 * debt because of a single loan line inside it.
 */
interface Line {
  id: string;
  name: string;
  plannedMinor: number;
  status: 'pending' | 'paid';
  type?: 'income' | 'expense';
  frequency?: 'monthly' | 'yearly' | 'one_time' | 'ongoing';
  loanId?: string | null;
}

/** The per-line split, exactly as `selectRatios` performs it. */
function splitLoanVsLiving(lines: Line[]) {
  let loan = 0;
  let living = 0;
  for (const line of lines) {
    if (!isSpend(line)) continue;
    const amount = monthlyAmount(line);
    if (line.loanId) loan += amount;
    else living += amount;
  }
  return { loan, living };
}

const line = (p: Partial<Line> & { id: string }): Line => ({
  name: p.id,
  plannedMinor: toMinor(10_000),
  status: 'pending',
  type: 'expense',
  frequency: 'monthly',
  loanId: null,
  ...p,
});

describe('debt split across a shared Debt category', () => {
  it('counts every loan line as debt, however many share the category', () => {
    const { loan } = splitLoanVsLiving([
      line({ id: 'personal', plannedMinor: toMinor(158_346), loanId: 'l1' }),
      line({ id: 'lease', plannedMinor: toMinor(122_866), loanId: 'l2' }),
    ]);
    expect(loan).toBe(toMinor(281_212));
  });

  it('does not treat a non-loan line filed under Debt as debt', () => {
    const { loan, living } = splitLoanVsLiving([
      line({ id: 'lease', plannedMinor: toMinor(122_866), loanId: 'l2' }),
      // e.g. a credit-card repayment the user parked in the same category.
      line({ id: 'card', plannedMinor: toMinor(20_000) }),
    ]);
    expect(loan).toBe(toMinor(122_866));
    expect(living).toBe(toMinor(20_000));
  });

  it('keeps income out of both buckets', () => {
    const { loan, living } = splitLoanVsLiving([
      line({ id: 'salary', plannedMinor: toMinor(750_000), type: 'income' }),
      line({ id: 'lease', plannedMinor: toMinor(122_866), loanId: 'l2' }),
    ]);
    expect(loan).toBe(toMinor(122_866));
    expect(living).toBe(0);
  });

  it('pro-rates a yearly loan-linked line like any other', () => {
    const { loan } = splitLoanVsLiving([
      line({ id: 'annual', plannedMinor: toMinor(120_000), frequency: 'yearly', loanId: 'l3' }),
    ]);
    expect(loan).toBe(toMinor(10_000));
  });

  it('reproduces the real board: loans are 38% of income, as shown on device', () => {
    const { loan, living } = splitLoanVsLiving([
      line({ id: 'personal', plannedMinor: toMinor(158_346.77), loanId: 'l1' }),
      line({ id: 'lease', plannedMinor: toMinor(122_866.59), loanId: 'l2' }),
      line({ id: 'rest', plannedMinor: toMinor(556_000) }),
    ]);
    const ratios = calculateRatios({
      incomeMinor: toMinor(750_000),
      loanMinor: loan,
      livingMinor: living,
    });
    expect(Math.round(ratios.loanPct)).toBe(38);
    // The plan exceeds income, so the balance is negative — as on the device.
    expect(ratios.disposableMinor).toBeLessThan(0);
  });
});
