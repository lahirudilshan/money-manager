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
  /*
   * The first installment falls a MONTH after drawdown, not on the day the
   * money arrives — so nothing is paid during the loan's first month.
   *
   * This is what made every brand-new loan report one installment already paid:
   * `loanDraftToInput` dates a new loan today, and the count was credited on the
   * start date itself.
   */
  it('counts nothing during the first month', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2025, 0, 20))).toBe(0);
  });

  it('counts nothing on the day the loan is taken out', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, start)).toBe(0);
  });

  it('counts the first payment once a month has passed', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2025, 1, 15))).toBe(1);
  });

  it('counts zero before the first due day', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2025, 0, 10))).toBe(0);
  });

  it('counts a full year of payments', () => {
    const start = new Date(2025, 0, 15);
    expect(paymentsElapsed(start, 60, new Date(2026, 0, 15))).toBe(12);
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

/*
 * Flat-rate loans — the method Sri Lankan vehicle leases are usually quoted on.
 *
 * The distinction is not cosmetic: the same headline rate produces a materially
 * bigger installment flat than reducing, because interest is charged on the
 * FULL principal for the whole term rather than on what is still owed.
 */
describe('flat-rate interest', () => {
  const FLAT = {
    principalMinor: toMinor(7_200_000),
    annualRatePct: 11.5,
    termMonths: 60,
    interestMethod: 'flat' as const,
  };

  it('charges interest on the full principal for the whole term', () => {
    // 7,200,000 x 11.5% x 5 years = 4,140,000
    expect(totalInterest(FLAT)).toBe(toMinor(4_140_000));
  });

  it('splits principal plus interest evenly', () => {
    // (7,200,000 + 4,140,000) / 60 = 189,000
    expect(monthlyInstallment(FLAT)).toBe(toMinor(189_000));
  });

  it('costs more than the same rate on reducing balance', () => {
    const flat = monthlyInstallment(FLAT);
    const reducing = monthlyInstallment({ ...FLAT, interestMethod: 'emi' });
    expect(flat).toBeGreaterThan(reducing);
    // ~30,653 a month on this loan — the reason the method has to be recorded
    // rather than assumed.
    expect(flat - reducing).toBe(toMinor(189_000) - toMinor(158_346.77));
  });

  it('charges the same interest every period, unlike a reducing loan', () => {
    const { schedule } = buildSchedule(FLAT);
    const first = schedule[0].interestMinor;
    expect(schedule[29].interestMinor).toBe(first);
    // The final row absorbs rounding drift, so it is excluded from this check.
    expect(schedule[58].interestMinor).toBe(first);
  });

  it('pays the balance down to exactly zero', () => {
    const { schedule } = buildSchedule(FLAT);
    expect(schedule[schedule.length - 1].balanceMinor).toBe(0);
  });

  it('defaults to reducing balance when no method is given', () => {
    const implicit = monthlyInstallment({
      principalMinor: toMinor(7_200_000),
      annualRatePct: 11.5,
      termMonths: 60,
    });
    // The user's spreadsheet figure — every loan recorded before the method
    // column existed was computed this way and must not change.
    expect(implicit).toBe(toMinor(158_346.77));
  });
});
