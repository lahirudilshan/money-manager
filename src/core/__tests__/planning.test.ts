import { describe, expect, it } from 'vitest';
import {
  amountToFund,
  calculateRatios,
  daysUntil,
  disposableIncome,
  dueDateFor,
  effectiveAmount,
  formatPeriod,
  isPaid,
  isPlanExpiringSoon,
  monthsBetween,
  nextStatus,
  periodKey,
  periodToDate,
  planFromMonthly,
  planHealth,
  savingPlanProgress,
  shiftPeriod,
  summariseBoard,
  appliesToPeriod,
  monthlyAmount,
  summariseCategory,
  urgencyFor,
  type CategoryStatus,
  type PlannedCategory,
} from '../planning';
import { toMinor } from '../money';

function cat(
  planned: number,
  status: CategoryStatus = 'pending',
  actual?: number,
): PlannedCategory {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Item',
    plannedMinor: toMinor(planned),
    actualMinor: actual === undefined ? null : toMinor(actual),
    status,
  };
}

describe('nextStatus', () => {
  it('toggles pending to paid', () => {
    expect(nextStatus('pending')).toBe('paid');
  });

  it('toggles paid back to pending, so a mis-tap can be undone', () => {
    expect(nextStatus('paid')).toBe('pending');
  });

  it('returns to the start after two taps', () => {
    expect(nextStatus(nextStatus('pending'))).toBe('pending');
  });
});

describe('isPaid', () => {
  it('is false while pending', () => {
    expect(isPaid('pending')).toBe(false);
  });

  it('is true once paid', () => {
    expect(isPaid('paid')).toBe(true);
  });
});

describe('effectiveAmount', () => {
  it('uses the planned amount by default', () => {
    expect(effectiveAmount(cat(15_000))).toBe(toMinor(15_000));
  });

  it('prefers the actual amount when recorded', () => {
    expect(effectiveAmount(cat(15_000, 'paid', 17_500))).toBe(toMinor(17_500));
  });

  it('treats an explicit zero actual as zero, not missing', () => {
    expect(effectiveAmount(cat(15_000, 'paid', 0))).toBe(0);
  });
});

describe('summariseCategory', () => {
  const homeExpenses = [
    cat(15_000, 'paid'),
    cat(10_000, 'pending'),
    cat(8_000, 'pending'),
    cat(35_000, 'pending'),
  ];

  it('totals every category', () => {
    const summary = summariseCategory(homeExpenses, 0);
    expect(summary.totalMinor).toBe(toMinor(68_000));
  });

  it('counts each status', () => {
    const summary = summariseCategory(homeExpenses, 0);
    expect(summary.counts).toEqual({ pending: 3, paid: 1 });
  });

  it('reports a shortfall when underfunded', () => {
    const summary = summariseCategory(homeExpenses, toMinor(20_000));
    expect(summary.shortfallMinor).toBe(toMinor(48_000));
    expect(summary.surplusMinor).toBe(0);
    expect(summary.isFullyFunded).toBe(false);
  });

  it('reports a surplus when overfunded', () => {
    const summary = summariseCategory(homeExpenses, toMinor(70_000));
    expect(summary.surplusMinor).toBe(toMinor(2_000));
    expect(summary.shortfallMinor).toBe(0);
    expect(summary.isFullyFunded).toBe(true);
  });

  it('is fully funded at exactly the total', () => {
    const summary = summariseCategory(homeExpenses, toMinor(68_000));
    expect(summary.isFullyFunded).toBe(true);
    expect(summary.shortfallMinor).toBe(0);
  });

  it('clamps funded percentage to 100', () => {
    const summary = summariseCategory(homeExpenses, toMinor(200_000));
    expect(summary.fundedPct).toBe(100);
  });

  it('sums only paid value into paidMinor', () => {
    const summary = summariseCategory(homeExpenses, 0);
    expect(summary.paidMinor).toBe(toMinor(15_000));
    expect(summary.outstandingMinor).toBe(toMinor(53_000));
  });

  it('is settled only when every bill is paid', () => {
    expect(summariseCategory(homeExpenses, 0).isSettled).toBe(false);
    const allDone = [cat(100, 'paid'), cat(200, 'paid')];
    expect(summariseCategory(allDone, 0).isSettled).toBe(true);
  });

  it('is not settled when the category is empty', () => {
    expect(summariseCategory([], 0).isSettled).toBe(false);
  });

  it('handles an empty category without dividing by zero', () => {
    const summary = summariseCategory([], toMinor(5_000));
    expect(summary.totalMinor).toBe(0);
    expect(summary.fundedPct).toBe(0);
    expect(summary.surplusMinor).toBe(toMinor(5_000));
  });

  it('uses actual amounts in the total when present', () => {
    const summary = summariseCategory([cat(10_000, 'paid', 12_000)], 0);
    expect(summary.totalMinor).toBe(toMinor(12_000));
  });
});

describe('amountToFund', () => {
  it('suggests the outstanding shortfall', () => {
    const summary = summariseCategory([cat(50_000)], toMinor(20_000));
    expect(amountToFund(summary)).toBe(toMinor(30_000));
  });

  it('suggests nothing when already fully funded', () => {
    const summary = summariseCategory([cat(50_000)], toMinor(80_000));
    expect(amountToFund(summary)).toBe(0);
  });
});

describe('summariseBoard', () => {
  it('rolls up totals across groups', () => {
    const a = summariseCategory([cat(50_000, 'paid')], toMinor(50_000));
    const b = summariseCategory([cat(30_000, 'pending')], toMinor(10_000));
    const board = summariseBoard([a, b]);

    expect(board.plannedMinor).toBe(toMinor(80_000));
    expect(board.fundedMinor).toBe(toMinor(60_000));
    expect(board.paidMinor).toBe(toMinor(50_000));
    expect(board.outstandingMinor).toBe(toMinor(30_000));
    expect(board.categoryCount).toBe(2);
    expect(board.settledCategoryCount).toBe(1);
    expect(board.fullyFundedCategoryCount).toBe(1);
  });

  it('returns zeros for no categories', () => {
    const board = summariseBoard([]);
    expect(board.plannedMinor).toBe(0);
    expect(board.categoryCount).toBe(0);
  });
});

describe('disposableIncome', () => {
  it('subtracts the plan from income', () => {
    expect(disposableIncome(toMinor(750_000), toMinor(517_213))).toBe(
      toMinor(232_787),
    );
  });

  it('goes negative when overcommitted', () => {
    expect(disposableIncome(toMinor(100_000), toMinor(140_000))).toBe(
      toMinor(-40_000),
    );
  });
});

describe('calculateRatios', () => {
  it('reproduces the spreadsheet ratio block', () => {
    const ratios = calculateRatios({
      incomeMinor: toMinor(750_000),
      loanMinor: toMinor(281_213),
      livingMinor: toMinor(236_000),
    });
    expect(ratios.loanPct).toBeCloseTo(37.5, 1);
    expect(ratios.livingPct).toBeCloseTo(31.47, 1);
    expect(ratios.disposableMinor).toBe(toMinor(232_787));
  });

  it('returns zeros rather than NaN at zero income', () => {
    const ratios = calculateRatios({
      incomeMinor: 0,
      loanMinor: toMinor(1_000),
      livingMinor: toMinor(500),
    });
    expect(ratios.loanPct).toBe(0);
    expect(ratios.freePct).toBe(0);
  });
});

describe('period helpers', () => {
  it('builds a zero-padded period key', () => {
    expect(periodKey(new Date(2026, 6, 15))).toBe('2026-07');
    expect(periodKey(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('round-trips a period key through a date', () => {
    expect(periodKey(periodToDate('2026-07'))).toBe('2026-07');
  });

  it('shifts forward across a year boundary', () => {
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });

  it('shifts backward across a year boundary', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
  });

  it('formats a period for display', () => {
    expect(formatPeriod('2026-07')).toMatch(/2026/);
  });
});

describe('dueDateFor', () => {
  it('resolves a normal due day within the period', () => {
    const date = dueDateFor('2026-07', 15);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6); // July, 0-indexed
    expect(date.getDate()).toBe(15);
  });

  it('clamps a day beyond the month length to the last day', () => {
    // February 2026 has 28 days; "due on the 31st" must not roll into March.
    const date = dueDateFor('2026-02', 31);
    expect(date.getMonth()).toBe(1);
    expect(date.getDate()).toBe(28);
  });

  it('clamps a day below 1 up to the first', () => {
    expect(dueDateFor('2026-07', 0).getDate()).toBe(1);
  });
});

describe('urgencyFor / daysUntil', () => {
  const today = new Date(2026, 6, 15);

  it('flags a past date as overdue', () => {
    expect(urgencyFor(new Date(2026, 6, 10), today)).toBe('overdue');
  });

  it('flags a date within a week as due soon', () => {
    expect(urgencyFor(new Date(2026, 6, 20), today)).toBe('due_soon');
  });

  it('flags today as due soon, not overdue', () => {
    expect(urgencyFor(new Date(2026, 6, 15), today)).toBe('due_soon');
  });

  it('flags a date more than a week out as upcoming', () => {
    expect(urgencyFor(new Date(2026, 6, 25), today)).toBe('upcoming');
  });

  it('counts whole days, negative once past due', () => {
    expect(daysUntil(new Date(2026, 6, 20), today)).toBe(5);
    expect(daysUntil(new Date(2026, 6, 10), today)).toBe(-5);
  });
});

describe('monthsBetween', () => {
  it('counts whole months ahead', () => {
    expect(monthsBetween(new Date(2026, 0, 10), new Date(2026, 3, 10))).toBe(3);
  });

  it('counts a partial month when the day is later', () => {
    expect(monthsBetween(new Date(2026, 0, 10), new Date(2026, 3, 20))).toBe(4);
  });

  it('floors at zero for past dates', () => {
    expect(monthsBetween(new Date(2026, 5, 10), new Date(2026, 0, 10))).toBe(0);
  });
});

describe('savingPlanProgress', () => {
  const plan = {
    targetMinor: toMinor(144_000),
    dueDate: new Date(2026, 11, 15),
    startDate: new Date(2026, 0, 15),
  };
  const today = new Date(2026, 3, 15); // 8 months to run

  it('divides the remaining amount across the remaining months', () => {
    const p = savingPlanProgress(plan, toMinor(24_000), today);
    expect(p.monthsRemaining).toBe(8);
    expect(p.remainingMinor).toBe(toMinor(120_000));
    expect(p.monthlyMinor).toBe(toMinor(15_000));
  });

  it('raises the monthly amount after falling behind', () => {
    const behind = savingPlanProgress(plan, 0, today);
    const onTrack = savingPlanProgress(plan, toMinor(24_000), today);
    expect(behind.monthlyMinor).toBeGreaterThan(onTrack.monthlyMinor);
  });

  it('reports completion once the target is reached', () => {
    const p = savingPlanProgress(plan, toMinor(144_000), today);
    expect(p.isComplete).toBe(true);
    expect(p.remainingMinor).toBe(0);
    expect(p.progressPct).toBe(100);
  });

  it('never reports a negative remainder when overfunded', () => {
    const p = savingPlanProgress(plan, toMinor(200_000), today);
    expect(p.remainingMinor).toBe(0);
    expect(p.progressPct).toBe(100);
  });

  it('demands the whole remainder once no months are left', () => {
    const p = savingPlanProgress(plan, toMinor(100_000), new Date(2026, 11, 20));
    expect(p.monthsRemaining).toBe(0);
    expect(p.monthlyMinor).toBe(toMinor(44_000));
  });

  it('flags an unfunded plan past its date as overdue', () => {
    const p = savingPlanProgress(plan, toMinor(10_000), new Date(2027, 0, 10));
    expect(p.isOverdue).toBe(true);
  });

  it('is not overdue once fully saved', () => {
    const p = savingPlanProgress(plan, toMinor(144_000), new Date(2027, 0, 10));
    expect(p.isOverdue).toBe(false);
  });
});

describe('planFromMonthly', () => {
  it('derives the total from monthly x months', () => {
    const plan = planFromMonthly(toMinor(12_000), 12, new Date(2026, 0, 1));
    expect(plan.targetMinor).toBe(toMinor(144_000));
    expect(plan.dueDate.getFullYear()).toBe(2027);
    expect(plan.dueDate.getMonth()).toBe(0);
  });
});

describe('isPlanExpiringSoon', () => {
  const plan = {
    targetMinor: toMinor(100_000),
    dueDate: new Date(2026, 5, 20),
    startDate: new Date(2026, 0, 1),
  };

  it('warns inside the window', () => {
    expect(isPlanExpiringSoon(plan, 14, new Date(2026, 5, 10))).toBe(true);
  });

  it('stays quiet outside the window', () => {
    expect(isPlanExpiringSoon(plan, 14, new Date(2026, 4, 1))).toBe(false);
  });

  it('stays quiet once past due', () => {
    expect(isPlanExpiringSoon(plan, 14, new Date(2026, 6, 1))).toBe(false);
  });
});

/**
 * Income lines live on the board next to expenses, but they are money coming
 * *in*. Counting them as planned spend is what made a category's total — and
 * the dashboard's PLANNED figure — exceed the income it is measured against.
 */
describe('summariseCategory with income lines', () => {
  const salary = {
    id: 'inc',
    name: 'Salary',
    plannedMinor: toMinor(300_000),
    status: 'pending' as const,
    type: 'income' as const,
  };
  const rent = {
    id: 'rent',
    name: 'Rent',
    plannedMinor: toMinor(50_000),
    status: 'pending' as const,
    type: 'expense' as const,
  };

  it('keeps income out of the planned spend total', () => {
    expect(summariseCategory([salary, rent], 0).totalMinor).toBe(toMinor(50_000));
  });

  it('reports income separately rather than discarding it', () => {
    expect(summariseCategory([salary, rent], 0).incomeMinor).toBe(toMinor(300_000));
  });

  it('counts only spend lines in the checklist', () => {
    expect(summariseCategory([salary, rent], 0).subcategoryCount).toBe(1);
  });

  it('settles once every spend line is paid, ignoring income lines', () => {
    const summary = summariseCategory([salary, { ...rent, status: 'paid' as const }], 0);
    expect(summary.isSettled).toBe(true);
  });

  it('an income-only category plans no spend at all', () => {
    const summary = summariseCategory([salary], 0);
    expect(summary.totalMinor).toBe(0);
    expect(summary.incomeMinor).toBe(toMinor(300_000));
  });

  it('treats an untyped line as spend, preserving old behaviour', () => {
    const untyped = { id: 'x', name: 'Old', plannedMinor: toMinor(1_000), status: 'pending' as const };
    expect(summariseCategory([untyped], 0).totalMinor).toBe(toMinor(1_000));
  });

  it('never lets income inflate the funding shortfall', () => {
    // Funding 50k against a 50k rent bill is fully funded, even though a
    // 300k income line shares the category.
    const summary = summariseCategory([salary, rent], toMinor(50_000));
    expect(summary.isFullyFunded).toBe(true);
    expect(summary.shortfallMinor).toBe(0);
  });
});

/**
 * A yearly bill is paid once but budgeted all year, so the monthly plan must
 * carry a twelfth of it. Counting the full amount every month inflated PLANNED
 * roughly elevenfold per yearly line and pushed it above income on boards that
 * were genuinely affordable.
 */
describe('monthlyAmount', () => {
  const line = (amount: number, frequency?: 'monthly' | 'one_time' | 'yearly' | 'unplanned') => ({
    id: 'x',
    name: 'x',
    plannedMinor: toMinor(amount),
    status: 'pending' as const,
    frequency,
  });

  it('spreads a yearly bill across twelve months', () => {
    expect(monthlyAmount(line(120_000, 'yearly'))).toBe(toMinor(10_000));
  });

  it('leaves a monthly bill at face value', () => {
    expect(monthlyAmount(line(50_000, 'monthly'))).toBe(toMinor(50_000));
  });

  it('leaves a one-time cost at face value in the month it lands', () => {
    expect(monthlyAmount(line(9_000, 'one_time'))).toBe(toMinor(9_000));
  });

  it('leaves unplanned spend at face value — it is real money already spent', () => {
    expect(monthlyAmount(line(4_500, 'unplanned'))).toBe(toMinor(4_500));
  });

  it('treats an unspecified frequency as monthly, preserving old behaviour', () => {
    expect(monthlyAmount(line(7_000))).toBe(toMinor(7_000));
  });

  it('prefers the actual amount over the plan when one was recorded', () => {
    expect(
      monthlyAmount({ ...line(120_000, 'yearly'), actualMinor: toMinor(60_000) }),
    ).toBe(toMinor(5_000));
  });

  it('sums back to roughly the annual figure over twelve months', () => {
    const monthly = monthlyAmount(line(120_000, 'yearly'));
    expect(monthly * 12).toBe(toMinor(120_000));
  });
});

describe('summariseCategory pro-rates yearly bills', () => {
  const expense = (id: string, amount: number, frequency: 'monthly' | 'yearly') => ({
    id,
    name: id,
    plannedMinor: toMinor(amount),
    status: 'pending' as const,
    type: 'expense' as const,
    frequency,
  });

  it('counts a yearly line at its monthly share', () => {
    const summary = summariseCategory(
      [expense('rent', 50_000, 'monthly'), expense('insurance', 120_000, 'yearly')],
      0,
    );
    expect(summary.totalMinor).toBe(toMinor(60_000));
  });

  it('uses the same basis for the paid total', () => {
    const summary = summariseCategory(
      [{ ...expense('insurance', 120_000, 'yearly'), status: 'paid' as const }],
      0,
    );
    expect(summary.paidMinor).toBe(toMinor(10_000));
    expect(summary.outstandingMinor).toBe(0);
  });
});

/**
 * A one-time cost belongs to the month it was incurred and to no other. Without
 * an anchor it recurred in every month forever, which is the opposite of what
 * "one time" means — a past down payment kept inflating this month's plan.
 */
describe('appliesToPeriod', () => {
  const oneTime = (period?: string) => ({
    id: 'dp',
    name: 'Down Payment',
    plannedMinor: toMinor(250_000),
    status: 'paid' as const,
    frequency: 'one_time' as const,
    period,
  });

  it('counts a one-time cost in its own month', () => {
    expect(appliesToPeriod(oneTime('2026-07'), '2026-07')).toBe(true);
  });

  it('drops a one-time cost from every later month', () => {
    expect(appliesToPeriod(oneTime('2026-07'), '2026-08')).toBe(false);
  });

  it('drops a one-time cost from earlier months too', () => {
    expect(appliesToPeriod(oneTime('2026-07'), '2026-06')).toBe(false);
  });

  it('keeps a one-time line with no anchor, so old rows do not vanish', () => {
    expect(appliesToPeriod(oneTime(undefined), '2026-08')).toBe(true);
  });

  it('never restricts a recurring line', () => {
    const monthly = { ...oneTime('2026-07'), frequency: 'monthly' as const };
    expect(appliesToPeriod(monthly, '2026-12')).toBe(true);
  });
});

describe('summariseCategory excludes past one-time costs', () => {
  const rent = {
    id: 'rent',
    name: 'Rent',
    plannedMinor: toMinor(35_000),
    status: 'pending' as const,
    type: 'expense' as const,
    frequency: 'monthly' as const,
    period: '2026-07',
  };
  const downPayment = {
    id: 'dp',
    name: 'Down Payment',
    plannedMinor: toMinor(250_000),
    status: 'paid' as const,
    type: 'expense' as const,
    frequency: 'one_time' as const,
    period: '2026-07',
  };

  it('includes the one-time cost in the month it happened', () => {
    expect(summariseCategory([rent, downPayment], 0, '2026-07').totalMinor).toBe(
      toMinor(285_000),
    );
  });

  it('excludes it from a later month', () => {
    expect(summariseCategory([rent, downPayment], 0, '2026-08').totalMinor).toBe(
      toMinor(35_000),
    );
  });

  it('keeps every line when no period is given', () => {
    expect(summariseCategory([rent, downPayment], 0).totalMinor).toBe(toMinor(285_000));
  });
});

/**
 * The anchor is the month a one-time cost was PAID, which is not necessarily
 * the month its line was created — a cost paid in June can be recorded in July
 * when the board is first set up. Anchoring to creation counted it in the wrong
 * month, so it kept inflating the month the user was actually looking at.
 */
describe('one-time costs anchor to the month they were paid', () => {
  const paidInJune = {
    id: 'dp',
    name: 'Down Payment',
    plannedMinor: toMinor(250_000),
    status: 'paid' as const,
    type: 'expense' as const,
    frequency: 'one_time' as const,
    period: '2026-06',
  };

  it('counts in the month it was paid, not the month it was recorded', () => {
    expect(appliesToPeriod(paidInJune, '2026-06')).toBe(true);
  });

  it('is excluded from the month the line was created in', () => {
    expect(appliesToPeriod(paidInJune, '2026-07')).toBe(false);
  });

  it('stays excluded in later months', () => {
    expect(appliesToPeriod(paidInJune, '2026-12')).toBe(false);
  });

  it('drops out of a category total for every other month', () => {
    const rent = {
      id: 'rent',
      name: 'Rent',
      plannedMinor: toMinor(35_000),
      status: 'pending' as const,
      type: 'expense' as const,
      frequency: 'monthly' as const,
    };
    expect(summariseCategory([rent, paidInJune], 0, '2026-06').totalMinor).toBe(
      toMinor(285_000),
    );
    expect(summariseCategory([rent, paidInJune], 0, '2026-07').totalMinor).toBe(
      toMinor(35_000),
    );
  });
});

/**
 * The headline cards colour themselves by this grade, so the boundaries matter:
 * a month one rupee into the red must not keep reading "on track".
 */
describe('planHealth', () => {
  const grade = (income: number, free: number, disposable: number) =>
    planHealth({
      incomeMinor: toMinor(income),
      freePct: free,
      disposableMinor: toMinor(disposable),
    });

  it('grades a month with room to save as healthy', () => {
    expect(grade(200_000, 35, 70_000)).toBe('healthy');
  });

  it('grades a balanced-but-thin month as tight', () => {
    expect(grade(200_000, 12, 24_000)).toBe('tight');
  });

  it('grades a month committed to nearly everything as critical', () => {
    expect(grade(200_000, 2, 4_000)).toBe('critical');
  });

  it('grades commitments beyond income as overspent', () => {
    expect(grade(200_000, -15, -30_000)).toBe('overspent');
  });

  it('treats the healthy and tight thresholds as inclusive floors', () => {
    expect(grade(200_000, 20, 40_000)).toBe('healthy');
    expect(grade(200_000, 19, 38_000)).toBe('tight');
    expect(grade(200_000, 5, 10_000)).toBe('tight');
    expect(grade(200_000, 4, 8_000)).toBe('critical');
  });

  it('trusts the money over a rounded percentage', () => {
    // percentOf rounds, so a hair below zero can present as 0% free — the sign
    // of the actual figure is what decides.
    expect(grade(200_000, 0, -1)).toBe('overspent');
  });

  it('reports unknown before any income is recorded', () => {
    // Onboarding: every ratio is zero, and calling that "overspent" would be a
    // false alarm on an empty plan.
    expect(grade(0, 0, 0)).toBe('unknown');
  });

  it('reports unknown rather than healthy for a plan with no income but no spend', () => {
    expect(planHealth({ incomeMinor: 0, freePct: 0, disposableMinor: 0 })).toBe('unknown');
  });
});
