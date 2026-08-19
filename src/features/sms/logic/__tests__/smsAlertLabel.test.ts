import { describe, expect, it } from 'vitest';
import { parseSms, splitItemisedFee } from '../smsParser';

/**
 * HNB's field-list alerts, which state the transaction TYPE as a bare label
 * instead of conjugating a verb.
 *
 * These were dropped silently, and the silence is what made it expensive. The
 * classifier accepts them (they are plainly transaction-shaped: an account, an
 * amount, a balance, a timestamp), and `isDiscardableNoise` therefore correctly
 * REFUSES to discard them — so each one sat in the inbox file forever. From the
 * outside the app looked like it was ignoring the file: the user could watch
 * the file get modified and no transaction ever appear.
 *
 * The cause was that `classifyDirection` only knew verbs. "PURCHASE" happened
 * to be both a verb and a label, so exactly one alert type worked and every
 * other one — INTERNET, ATM, POS, FUND TRANSFER — returned null.
 */

/** The message that was actually stuck in the user's inbox file. */
const UBER_EATS =
  'HNB SMS ALERT:INTERNET, Account:1380***6626,Location:UBER EATS, LK,Amount(Approx.):3497.91 LKR,Av.Bal:21427.48 LKR,Date:16.08.26,Time:01:29, Hot Line:0112462462';

describe('the INTERNET alert that would not import', () => {
  it('parses at all', () => {
    // The whole bug in one assertion: this returned null.
    expect(parseSms(UBER_EATS)).not.toBeNull();
  });

  it('reads the amount, merchant and account', () => {
    const parsed = parseSms(UBER_EATS)!;
    expect(parsed.amountMinor).toBe(349_791);
    expect(parsed.currency).toBe('LKR');
    expect(parsed.merchant).toBe('UBER EATS, LK');
    expect(parsed.account).toBe('6626');
  });

  it('is money going out, as a card purchase', () => {
    const parsed = parseSms(UBER_EATS)!;
    expect(parsed.direction).toBe('debit');
    /*
     * `purchase`, not `other`. "INTERNET" is HNB's word for a card-not-present
     * payment, and the kind is what gives the draft its category prior — an
     * `other` reaches the review queue with no suggestion at all.
     */
    expect(parsed.kind).toBe('purchase');
  });

  it('takes the transaction amount, not the balance beside it', () => {
    // "Av.Bal:21427.48 LKR" sits in the same comma-separated run.
    expect(parseSms(UBER_EATS)!.amountMinor).not.toBe(2_142_748);
  });
});

describe('the other alert labels that were also being dropped', () => {
  const alert = (label: string) =>
    `HNB SMS ALERT:${label}, Account:1380***6626,Location:SOME MERCHANT, LK,Amount(Approx.):1500.00 LKR,Av.Bal:21427.48 LKR,Date:16.08.26,Time:01:29`;

  it.each([
    ['INTERNET', 'purchase'],
    ['IPG', 'purchase'],
    ['POS', 'purchase'],
    ['PURCHASE', 'purchase'],
    ['ATM', 'atm'],
    ['CASH WITHDRAWAL', 'atm'],
    ['FUND TRANSFER', 'transfer_out'],
  ])('reads %s as a debit of kind %s', (label, kind) => {
    const parsed = parseSms(alert(label));
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('debit');
    expect(parsed!.kind).toBe(kind);
    expect(parsed!.amountMinor).toBe(150_000);
  });

  it('reads a CREDIT label as money arriving', () => {
    const parsed = parseSms(alert('CREDIT'))!;
    expect(parsed.direction).toBe('credit');
  });

  it('ignores a label it has never seen rather than inventing a direction', () => {
    /*
     * The safety property. An unknown label must NOT default to "debit" — that
     * turns any future alert format into spend the user never made. Returning
     * null leaves the message in the file, which is visible and fixable.
     */
    expect(parseSms(alert('SOMETHING NEW'))).toBeNull();
  });

  it('lets an explicit verb outrank the label', () => {
    // A reversal is credited despite riding on a PURCHASE-flavoured heading.
    const reversal =
      'HNB SMS ALERT:PURCHASE, A reversal for POS TXN of LKR 1,038.30 credited to AC XXXXXXXX6796';
    expect(parseSms(reversal)!.direction).toBe('credit');
  });
});

/**
 * The 9,000-rupee "bank fee".
 *
 * An ATM receipt states two amounts — the withdrawal and the bank's charge —
 * and only the second is a fee. The fee reader's label list ended in a bare
 * `fee|charges?`, and the separator in front of the amount was loose enough
 * that the bare label could bind to a number further along the message. So a
 * receipt could yield a "fee" equal to the WITHDRAWAL, and 9,000 landed on the
 * Bank charges line while the 30 next to it was read correctly.
 */
describe('the ATM receipt that itemises its own fee', () => {
  const RECEIPT =
    'HNB ATM Withdrawal e-Receipt\nAmt(Approx.): 9000.00 LKR\nTxn Fee: 30.00LKR\nAc No:13802XXXXX50\nLocation: ICBS , LKA\nDate:16.08.26 Time:01:29';

  it('reads the withdrawal as 9,000, not as a fee', () => {
    const parsed = parseSms(RECEIPT)!;
    expect(parsed.amountMinor).toBe(900_000);
    expect(parsed.kind).toBe('atm');
  });

  it('splits the 30 out as the bank charge', () => {
    const fee = splitItemisedFee(parseSms(RECEIPT)!)!;
    expect(fee.amountMinor).toBe(3_000);
    expect(fee.kind).toBe('bank_charge');
  });

  it('never lets the fee be a large share of the transaction', () => {
    /*
     * The guard that closes the misread. A bank charge is a small cut of what
     * it is charged on; a "fee" that is most of the parent is the label having
     * captured the transaction's own amount.
     */
    const misread =
      'HNB ATM Withdrawal e-Receipt\nAmt(Approx.): 9000.00 LKR\nCharges 9000.00 LKR\nAc No:13802XXXXX50';
    expect(splitItemisedFee(parseSms(misread)!)).toBeNull();
  });

  it('does not invent a fee from a receipt that merely mentions charges', () => {
    const passing =
      'Cash withdrawal of 9000.00 LKR. Service charge applied. Avl Bal 21427.48 LKR';
    const parsed = parseSms(passing);
    if (parsed) expect(splitItemisedFee(parsed)).toBeNull();
  });

  it('survives a round trip through the queue without becoming the parent', () => {
    /*
     * The queue re-parses `raw` on every load, so the stored fee row must come
     * back as 30 — not as a second 9,000 withdrawal.
     */
    const fee = splitItemisedFee(parseSms(RECEIPT)!)!;
    const reloaded = parseSms(fee.raw)!;
    expect(reloaded.amountMinor).toBe(3_000);
    expect(reloaded.kind).toBe('bank_charge');
  });
});
