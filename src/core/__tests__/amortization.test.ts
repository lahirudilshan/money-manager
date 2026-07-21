import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  monthlyInstallment,
  paymentsElapsed,
  remainingBalance,
  totalInterest,
} from '../amortization';
import { toMinor } from '../money';

// Figures taken from the user's planning spreadsheet, used as ground truth.
const PERSONAL_LOAN = {
  principalMinor: toMinor(7_200_000),
  annualRatePct: 11.5,
  termMonths: 60,
};

const LEASE = {
  principalMinor: toMinor(5_400_000),
  annualRatePct: 13,
  termMonths: 60,
};

describe('monthlyInstallment', () => {
  it('matches the spreadsheet personal loan installment', () => {
    // Sheet says LKR 158,347.
    const installment = monthlyInstallment(PERSONAL_LOAN);
    expect(Math.round(installment / 100)).toBe(158_347);
  });

  it('matches the spreadsheet lease installment', () => {
    // Sheet says LKR 122,867.
    const installment = monthlyInstallment(LEASE);
    expect(Math.round(installment / 100)).toBe(122_867);
  });

  it('divides evenly when the rate is zero', () => {
    const installment = monthlyInstallment({
      principalMinor: toMinor(120_000),
      annualRatePct: 0,
      termMonths: 12,
    });
    expect(installment).toBe(toMinor(10_000));
  });

  it('returns zero for a zero principal', () => {
    expect(
      monthlyInstallment({ principalMinor: 0, annualRatePct: 14, termMonths: 60 }),
    ).toBe(0);
  });

  it('returns zero for a zero term rather than dividing by zero', () => {
    expect(
      monthlyInstallment({
        principalMinor: toMinor(100_000),
        annualRatePct: 10,
        termMonths: 0,
      }),
    ).toBe(0);
  });
});

describe('totalInterest', () => {
  it('matches the spreadsheet personal loan interest within rounding', () => {
    // Sheet says LKR 2,300,806.
    const interest = totalInterest(PERSONAL_LOAN) / 100;
    expect(Math.abs(interest - 2_300_806)).toBeLessThan(500);
  });

  it('matches the spreadsheet lease interest within rounding', () => {
    // Sheet says LKR 1,971,996.
    const interest = totalInterest(LEASE) / 100;
    expect(Math.abs(interest - 1_971_996)).toBeLessThan(500);
  });

  it('is zero for an interest-free loan', () => {
    expect(
      totalInterest({
        principalMinor: toMinor(60_000),
        annualRatePct: 0,
        termMonths: 6,
      }),
    ).toBe(0);
  });
});

describe('buildSchedule', () => {
  it('produces one entry per month of the term', () => {
    expect(buildSchedule(PERSONAL_LOAN).schedule).toHaveLength(60);
  });

  it('pays the balance down to exactly zero', () => {
    const { schedule } = buildSchedule(PERSONAL_LOAN);
    expect(schedule[schedule.length - 1].balanceMinor).toBe(0);
  });

  it('repays exactly the principal across all periods', () => {
    const { schedule } = buildSchedule(LEASE);
    const principalRepaid = schedule.reduce((sum, e) => sum + e.principalMinor, 0);
    expect(principalRepaid).toBe(LEASE.principalMinor);
  });

  it('splits every payment into principal + interest', () => {
    const { schedule } = buildSchedule(LEASE);
    for (const entry of schedule) {
      expect(entry.principalMinor + entry.interestMinor).toBe(entry.paymentMinor);
    }
  });

  it('shifts from interest-heavy to principal-heavy over time', () => {
    const { schedule } = buildSchedule(PERSONAL_LOAN);
    const first = schedule[0];
    const last = schedule[schedule.length - 1];
    expect(first.interestMinor).toBeGreaterThan(last.interestMinor);
    expect(first.principalMinor).toBeLessThan(last.principalMinor);
  });

  it('has total paid equal principal plus total interest', () => {
    const summary = buildSchedule(PERSONAL_LOAN);
    expect(summary.totalPaidMinor).toBe(
      PERSONAL_LOAN.principalMinor + summary.totalInterestMinor,
    );
  });

  it('returns an empty schedule for a zero-principal loan', () => {
    const summary = buildSchedule({
      principalMinor: 0,
      annualRatePct: 14,
      termMonths: 60,
    });
    expect(summary.schedule).toEqual([]);
    expect(summary.totalInterestMinor).toBe(0);
  });
});

describe('remainingBalance', () => {
  it('returns the full principal before any payment', () => {
    expect(remainingBalance(PERSONAL_LOAN, 0)).toBe(PERSONAL_LOAN.principalMinor);
  });

  it('returns zero once the term is complete', () => {
    expect(remainingBalance(PERSONAL_LOAN, 60)).toBe(0);
  });

  it('returns zero when overpaid past the term', () => {
    expect(remainingBalance(PERSONAL_LOAN, 90)).toBe(0);
  });

  it('decreases monotonically', () => {
    const a = remainingBalance(PERSONAL_LOAN, 12);
    const b = remainingBalance(PERSONAL_LOAN, 24);
    expect(b).toBeLessThan(a);
  });
});

describe('paymentsElapsed', () => {
  it('counts one payment once the first due day passes', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2025, 0, 20))).toBe(1);
  });

  it('counts zero before the first due day', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2025, 0, 10))).toBe(0);
  });

  it('counts a full year of payments', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2026, 0, 15))).toBe(13);
  });

  it('never exceeds the loan term', () => {
    const start = new Date(2015, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2030, 0, 15))).toBe(60);
  });

  it('never goes negative for a future-dated loan', () => {
    const start = new Date(2030, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2025, 0, 15))).toBe(0);
  });
});
