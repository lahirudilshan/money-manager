import { describe, expect, it } from 'vitest';
import {
  amountToFund,
  calculateRatios,
  disposableIncome,
  effectiveAmount,
  formatPeriod,
  isFunded,
  nextStatus,
  periodKey,
  periodToDate,
  shiftPeriod,
  summariseBoard,
  summariseCategory,
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
  it('advances pending to transferred', () => {
    expect(nextStatus('pending')).toBe('transferred');
  });

  it('advances transferred to completed', () => {
    expect(nextStatus('transferred')).toBe('completed');
  });

  it('wraps completed back to pending so a mis-tap can be undone', () => {
    expect(nextStatus('completed')).toBe('pending');
  });

  it('returns to the start after three taps', () => {
    expect(nextStatus(nextStatus(nextStatus('pending')))).toBe('pending');
  });
});

describe('isFunded', () => {
  it('is false while pending', () => {
    expect(isFunded('pending')).toBe(false);
  });

  it('is true once transferred or completed', () => {
    expect(isFunded('transferred')).toBe(true);
    expect(isFunded('completed')).toBe(true);
  });
});

describe('effectiveAmount', () => {
  it('uses the planned amount by default', () => {
    expect(effectiveAmount(cat(15_000))).toBe(toMinor(15_000));
  });

  it('prefers the actual amount when recorded', () => {
    expect(effectiveAmount(cat(15_000, 'completed', 17_500))).toBe(toMinor(17_500));
  });

  it('treats an explicit zero actual as zero, not missing', () => {
    expect(effectiveAmount(cat(15_000, 'completed', 0))).toBe(0);
  });
});

describe('summariseCategory', () => {
  const homeExpenses = [
    cat(15_000, 'completed'),
    cat(10_000, 'transferred'),
    cat(8_000, 'pending'),
    cat(35_000, 'pending'),
  ];

  it('totals every category', () => {
    const summary = summariseCategory(homeExpenses, 0);
    expect(summary.totalMinor).toBe(toMinor(68_000));
  });

  it('counts each status', () => {
    const summary = summariseCategory(homeExpenses, 0);
    expect(summary.counts).toEqual({ pending: 2, transferred: 1, completed: 1 });
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

  it('sums only completed value into completedMinor', () => {
    const summary = summariseCategory(homeExpenses, 0);
    expect(summary.completedMinor).toBe(toMinor(15_000));
    expect(summary.outstandingMinor).toBe(toMinor(53_000));
  });

  it('is settled only when every category is completed', () => {
    expect(summariseCategory(homeExpenses, 0).isSettled).toBe(false);
    const allDone = [cat(100, 'completed'), cat(200, 'completed')];
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
    const summary = summariseCategory([cat(10_000, 'completed', 12_000)], 0);
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
    const a = summariseCategory([cat(50_000, 'completed')], toMinor(50_000));
    const b = summariseCategory([cat(30_000, 'pending')], toMinor(10_000));
    const board = summariseBoard([a, b]);

    expect(board.plannedMinor).toBe(toMinor(80_000));
    expect(board.fundedMinor).toBe(toMinor(60_000));
    expect(board.completedMinor).toBe(toMinor(50_000));
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
