import { describe, expect, it } from 'vitest';
import { classifySms } from '../smsClassifier';
import { parseSms, extractStatementBill } from '../smsParser';
import { inferCategoryHint } from '../smsCategoryHints';

/**
 * A utility bill delivered as a STATEMENT rather than a sentence.
 *
 * Every bill format the parser handled before this said its due date in prose —
 * "your bill of LKR 3,450 is due on 15 Aug". CEB's e-bill says nothing of the
 * sort. It is a labelled ledger:
 *
 *   B/F: Rs. 9,470.76          <- last month's balance brought forward
 *   Payments: Rs. 9,500.00     <- what was already paid
 *   Outstanding: Rs. 23.84 by 2026-08-11
 *   Monthly Bill: Rs. 9,071.79 <- this month's charge
 *   Total Due: Rs. 9,095.63    <- what CEB actually wants
 *
 * Three separate things were wrong with it, and each one alone was fatal:
 *
 *  1. `classifyDirection` found no BILL_PATTERN — "Total Due:" is not "due
 *     on/by", and the "Monthly Bill ... Total Due" pair is split across lines
 *     by an amount containing a `.`, which `\bbill\b[^.]*\bdue\b` cannot cross.
 *     A null direction is an unconditional drop, so the bill vanished silently.
 *  2. `extractAmount` takes the first amount that is not a balance or a fee.
 *     Here that is `B/F: Rs. 9,470.76` — LAST month's carried balance, a number
 *     the user does not owe and which is off by 375 rupees from the real figure.
 *  3. The only dates in the message are a reading date and an
 *     already-past outstanding-by date. Neither is a payment due date.
 *
 * The fixture is the user's real August 2026 bill, kept verbatim.
 */
const CEB_BILL = `A/C No: 4818257605 (D1)
B M R PERERA

B/F: Rs. 9,470.76
Payments: Rs. 9,500.00
Debits: Rs. 53.08
Outstanding: Rs. 23.84 by 2026-08-11

Reading Date: 2026-08-15 (456)
Reading: 12764 - 12575 = 189 Units
Charge: Rs. 8,845.00
SSC Levy: Rs. 226.79
Monthly Bill: Rs. 9,071.79

Total Due: Rs. 9,095.63

View e-Bill here:
https://ebill.ceb.lk/v1/NDgxODI1NzYwNSo0NTYqNDAw`;

describe('CEB statement bill', () => {
  it('is accepted by the classifier', () => {
    expect(classifySms(CEB_BILL).isTransaction).toBe(true);
  });

  /** The regression that started this: the whole message parsed to null. */
  it('parses at all', () => {
    expect(parseSms(CEB_BILL)).not.toBeNull();
  });

  it('reads as an issued bill, not a completed movement', () => {
    const parsed = parseSms(CEB_BILL);
    expect(parsed?.direction).toBe('bill');
    expect(parsed?.kind).toBe('utility');
  });

  /**
   * The amount is Total Due — not B/F, which is what first-match picked.
   *
   * 9,095.63 rather than 9,470.76. Both are plausible-looking five-figure
   * rupee amounts, which is exactly why this needs a test: the wrong one is not
   * obviously wrong on screen.
   */
  it('reads Total Due as the amount, not the brought-forward balance', () => {
    expect(parseSms(CEB_BILL)?.amountMinor).toBe(909_563);
  });

  it('names the biller', () => {
    expect(parseSms(CEB_BILL)?.merchant).toMatch(/CEB|electricity/i);
  });

  it('keeps the account number', () => {
    expect(parseSms(CEB_BILL)?.account).toContain('4818257605');
  });
});

describe('statement breakdown', () => {
  const bill = extractStatementBill(CEB_BILL);

  it('extracts every labelled line it needs', () => {
    expect(bill).not.toBeNull();
    expect(bill?.totalDueMinor).toBe(909_563);
    expect(bill?.monthlyBillMinor).toBe(907_179);
    expect(bill?.outstandingMinor).toBe(2_384);
  });

  /** The meter reading — what drives the usage chart on the detail page. */
  it('reads the meter figures', () => {
    expect(bill?.units).toBe(189);
    expect(bill?.readingCurrent).toBe(12_764);
    expect(bill?.readingPrevious).toBe(12_575);
    expect(bill?.readingDate).toBe('2026-08-15');
  });

  it('reads the account number', () => {
    expect(bill?.accountNumber).toBe('4818257605');
  });

  /**
   * `units` must be the stated figure, never recomputed silently.
   *
   * A meter rollover makes `current - previous` negative, and CEB prints the
   * true unit count anyway. Trusting the arithmetic over the label would report
   * a negative month's usage on the chart.
   */
  it('trusts the stated unit count over the subtraction', () => {
    const rollover = CEB_BILL.replace(
      'Reading: 12764 - 12575 = 189 Units',
      'Reading: 00120 - 99880 = 240 Units',
    );
    expect(extractStatementBill(rollover)?.units).toBe(240);
  });

  /** An ordinary bank alert is not a statement and must yield nothing. */
  it('returns null for a non-statement message', () => {
    expect(
      extractStatementBill('LKR 2,500.00 debited at KEELLS SUPER on 02/08. Avl Bal 12,000.00'),
    ).toBeNull();
  });
});

/**
 * The statement path must not swallow ordinary messages.
 *
 * These are the formats that already worked, re-asserted here because the new
 * direction rule ("a labelled Total Due makes this a bill") is broad enough to
 * misfire if it were written loosely.
 */
describe('does not disturb existing formats', () => {
  it('leaves a POS purchase a debit', () => {
    const parsed = parseSms(
      'LKR 2,500.00 debited at KEELLS SUPER on 02/08/2026. Avl Bal LKR 12,000.00',
    );
    expect(parsed?.direction).toBe('debit');
    expect(parsed?.amountMinor).toBe(250_000);
  });

  it('leaves a prose bill notice working', () => {
    const parsed = parseSms('CEB: Your electricity bill for Acct 0012345678 is Rs.8,450.00 due on 05/08/2026');
    expect(parsed?.direction).toBe('bill');
    expect(parsed?.amountMinor).toBe(845_000);
  });

  it('still rejects an OTP that mentions a total', () => {
    expect(
      parseSms('Your one-time password for transaction LKR 2500.00 at CEB is 681854.'),
    ).toBeNull();
  });

  /**
   * A CREDIT CARD alert states a movement AND a total due, and the movement is
   * what matters.
   *
   * This is the regression the statement rule introduced and very nearly
   * shipped: the `Total Due` label won, the message became a 3,000-rupee bill,
   * and the 25,000 that actually left the account was never recorded at all.
   * Silent missing spend is the worst outcome this parser has — a wrong figure
   * is at least visible on the card.
   */
  it('reads a card alert quoting a total due as the DEBIT, not the total', () => {
    const parsed = parseSms(
      'LKR 25,000.00 debited. Total Due: LKR 3,000.00 on your card ending 1234',
    );
    expect(parsed?.direction).toBe('debit');
    expect(parsed?.amountMinor).toBe(2_500_000);
  });

  /** The same guard, the other way round: a credit is not a statement either. */
  it('reads a credit quoting an outstanding balance as the CREDIT', () => {
    const parsed = parseSms(
      'LKR 50,000.00 credited to AC XXXX6796. Amount Due: LKR 2,000.00',
    );
    expect(parsed?.direction).toBe('credit');
    expect(parsed?.amountMinor).toBe(5_000_000);
  });
});

/**
 * The reconciler has to find a home for the bill.
 *
 * Parsing it correctly is worth nothing if the draft then arrives with no
 * suggestion — the user would confirm the amount and still have to pick the
 * line by hand every month. "CEB Electricity" is the name `statementBiller`
 * produces, so that is the string the category hints must recognise.
 */
describe('routing the parsed bill', () => {
  it('hints electricity from the biller name', () => {
    expect(inferCategoryHint('CEB Electricity')).toBe('electricity');
  });

  it('hints electricity from the statement itself', () => {
    expect(inferCategoryHint(CEB_BILL)).toBe('electricity');
  });
});
