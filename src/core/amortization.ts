import type { Minor } from './money';

/**
 * Standard amortising-loan math (equal monthly installments).
 *
 * Verified against the source spreadsheet:
 *   7,200,000 @ 11.50% / 5y -> 158,347/mo, ~2,300,806 total interest
 *   5,400,000 @ 13.00% / 5y -> 122,867/mo, ~1,971,996 total interest
 */

export interface LoanTerms {
  principalMinor: Minor;
  /** Annual nominal rate as a percentage, e.g. 11.5 for 11.50%. */
  annualRatePct: number;
  termMonths: number;
}

export interface AmortizationEntry {
  /** 1-based installment number. */
  period: number;
  paymentMinor: Minor;
  principalMinor: Minor;
  interestMinor: Minor;
  /** Outstanding balance after this payment. */
  balanceMinor: Minor;
}

export interface LoanSummary {
  installmentMinor: Minor;
  totalPaidMinor: Minor;
  totalInterestMinor: Minor;
  schedule: AmortizationEntry[];
}

/**
 * Monthly installment via the standard annuity formula:
 *   P * r / (1 - (1 + r)^-n)
 *
 * Zero-interest loans divide evenly instead — the formula is undefined at r=0.
 */
export function monthlyInstallment(terms: LoanTerms): Minor {
  const { principalMinor, annualRatePct, termMonths } = terms;
  if (principalMinor <= 0 || termMonths <= 0) return 0;

  const monthlyRate = annualRatePct / 100 / 12;
  if (monthlyRate === 0) return Math.round(principalMinor / termMonths);

  const factor = (1 + monthlyRate) ** -termMonths;
  return Math.round((principalMinor * monthlyRate) / (1 - factor));
}

/**
 * Full amortisation schedule.
 *
 * The final installment absorbs any rounding drift so the balance lands exactly
 * on zero — otherwise decades of half-cent rounding leave a phantom balance.
 */
export function buildSchedule(terms: LoanTerms): LoanSummary {
  const { principalMinor, annualRatePct, termMonths } = terms;
  const installmentMinor = monthlyInstallment(terms);

  if (principalMinor <= 0 || termMonths <= 0) {
    return {
      installmentMinor: 0,
      totalPaidMinor: 0,
      totalInterestMinor: 0,
      schedule: [],
    };
  }

  const monthlyRate = annualRatePct / 100 / 12;
  const schedule: AmortizationEntry[] = [];

  let balance = principalMinor;
  let totalInterest = 0;
  let totalPaid = 0;

  for (let period = 1; period <= termMonths; period += 1) {
    const interest = Math.round(balance * monthlyRate);
    const isFinal = period === termMonths;

    // On the last period, pay off exactly what remains.
    const payment = isFinal ? balance + interest : installmentMinor;
    const principalPart = payment - interest;

    balance -= principalPart;
    // Guard against tiny negative drift on the final row.
    if (isFinal || balance < 0) balance = Math.max(0, balance);

    totalInterest += interest;
    totalPaid += payment;

    schedule.push({
      period,
      paymentMinor: payment,
      principalMinor: principalPart,
      interestMinor: interest,
      balanceMinor: balance,
    });
  }

  return {
    installmentMinor,
    totalPaidMinor: totalPaid,
    totalInterestMinor: totalInterest,
    schedule,
  };
}

/** Total interest over the life of the loan. */
export function totalInterest(terms: LoanTerms): Minor {
  return buildSchedule(terms).totalInterestMinor;
}

/**
 * Outstanding balance after `paymentsMade` installments — drives the
 * "remaining" figure on the loans screen.
 */
export function remainingBalance(terms: LoanTerms, paymentsMade: number): Minor {
  if (paymentsMade <= 0) return terms.principalMinor;
  const { schedule } = buildSchedule(terms);
  if (paymentsMade >= schedule.length) return 0;
  return schedule[paymentsMade - 1].balanceMinor;
}

/**
 * How many installments have come due between the loan start and `asOf`.
 * Clamped to the loan term so an old loan never reports more than its term.
 */
export function paymentsElapsed(
  startDate: Date,
  termMonths: number,
  asOf: Date = new Date(),
): number {
  const months =
    (asOf.getFullYear() - startDate.getFullYear()) * 12 +
    (asOf.getMonth() - startDate.getMonth()) +
    // The installment for a month is only due once its day-of-month passes.
    (asOf.getDate() >= startDate.getDate() ? 1 : 0);
  return Math.max(0, Math.min(termMonths, months));
}
