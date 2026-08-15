import type { Minor } from './money';

/**
 * Standard amortising-loan math (equal monthly installments).
 *
 * Verified against the source spreadsheet:
 *   7,200,000 @ 11.50% / 5y -> 158,347/mo, ~2,300,806 total interest
 *   5,400,000 @ 13.00% / 5y -> 122,867/mo, ~1,971,996 total interest
 */

/**
 * How the lender applies the quoted rate. The same headline percentage means
 * two very different sums, so this cannot be inferred — it has to be recorded.
 */
export type InterestMethod =
  /**
   * Reducing balance (EMI). Interest is charged on the OUTSTANDING balance, so
   * it falls every month as the principal is repaid. This is how banks quote
   * personal loans and mortgages.
   */
  | 'emi'
  /**
   * Flat rate. Interest is calculated once on the FULL principal for the whole
   * term, then split evenly across the installments — it never falls, because
   * repaying principal does not reduce the base it is charged on.
   *
   * Standard for vehicle leases here, and materially more expensive than the
   * same headline rate reducing: 7,200,000 at 11.5% over 5 years is 158,347 a
   * month on reducing balance, but 189,000 flat.
   */
  | 'flat';

export interface LoanTerms {
  principalMinor: Minor;
  /** Annual nominal rate as a percentage, e.g. 11.5 for 11.50%. */
  annualRatePct: number;
  termMonths: number;
  /** Defaults to `emi`, matching every loan recorded before this existed. */
  interestMethod?: InterestMethod;
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
  const { principalMinor, annualRatePct, termMonths, interestMethod = 'emi' } = terms;
  if (principalMinor <= 0 || termMonths <= 0) return 0;

  /*
   * Flat rate: the whole term's interest, worked out once on the full
   * principal, then divided evenly along with the principal itself.
   *
   *   interest    = P × rate × years
   *   installment = (P + interest) / n
   *
   * No annuity discounting, because nothing is discounted — the borrower pays
   * interest on the original amount for every month of the term, whatever they
   * have already repaid.
   */
  if (interestMethod === 'flat') {
    const years = termMonths / 12;
    const interest = principalMinor * (annualRatePct / 100) * years;
    return Math.round((principalMinor + interest) / termMonths);
  }

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
  const { principalMinor, annualRatePct, termMonths, interestMethod = 'emi' } = terms;
  const installmentMinor = monthlyInstallment(terms);

  if (principalMinor <= 0 || termMonths <= 0) {
    return {
      installmentMinor: 0,
      totalPaidMinor: 0,
      totalInterestMinor: 0,
      schedule: [],
    };
  }

  /*
   * A flat loan's rows are a different shape, not just different numbers.
   *
   * Every period carries the SAME interest — one twelfth of the annual charge
   * on the full principal — and the same principal share, because neither is
   * affected by what has been repaid. So this cannot reuse the reducing-balance
   * loop below, which derives interest from the running balance.
   */
  if (interestMethod === 'flat') {
    const totalInterestFlat = Math.round(
      principalMinor * (annualRatePct / 100) * (termMonths / 12),
    );
    const interestPerPeriod = Math.round(totalInterestFlat / termMonths);
    const schedule: AmortizationEntry[] = [];

    let balance = principalMinor;
    let interestBooked = 0;
    let totalPaid = 0;

    for (let period = 1; period <= termMonths; period += 1) {
      const isFinal = period === termMonths;

      // The last row absorbs both rounding drifts — interest and principal —
      // so the totals match the quoted figures exactly and the balance lands
      // on zero rather than a few cents either side.
      const interest = isFinal ? totalInterestFlat - interestBooked : interestPerPeriod;
      const payment = isFinal ? balance + interest : installmentMinor;
      const principalPart = payment - interest;

      balance = Math.max(0, balance - principalPart);
      interestBooked += interest;
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
      totalInterestMinor: totalInterestFlat,
      schedule,
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
  const wholeMonths =
    (asOf.getFullYear() - startDate.getFullYear()) * 12 +
    (asOf.getMonth() - startDate.getMonth());

  /*
   * The FIRST installment falls a month after the loan starts, not on the day
   * it is drawn — so a loan taken out today has nothing paid yet.
   *
   * The old form added 1 as soon as the day-of-month was reached, which on the
   * start date itself is trivially true (`asOf.getDate() >= startDate.getDate()`
   * compares a date to itself). Every brand-new loan therefore reported one
   * installment already paid, and its remaining balance was a month short.
   *
   * Counting whole elapsed months and then crediting the current month only
   * once its due day has passed gives the same answer for an established loan
   * and the correct 0 for a new one.
   */
  const months =
    wholeMonths > 0 && asOf.getDate() < startDate.getDate() ? wholeMonths - 1 : wholeMonths;

  return Math.max(0, Math.min(termMonths, months));
}
