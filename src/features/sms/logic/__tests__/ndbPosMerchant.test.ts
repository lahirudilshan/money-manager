import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';

/**
 * NDB's alert format, which prints the payee after an "@".
 *
 * Two real messages from the user's phone, and the parser got both wrong in a
 * way that made the review queue useless for them:
 *
 *   - the shop's name sits after "@" and before the stated transaction type,
 *     and no clause read it, so `merchant` came out EMPTY — and an empty
 *     merchant matches no category, so the draft arrived with nothing to
 *     suggest;
 *   - the text ends "ATM POS Transaction", and the kind rule matched the bare
 *     word ATM, so a card purchase at a pharmacy was classified as a cash
 *     withdrawal.
 *
 * "ATM POS Transaction" is a card payment made at a POS terminal. Only
 * "ATM ... Cash Withdrawal" is money out of a machine.
 */

const PHARMACY =
  'Dear MR M N LAHIRU DILSHAN,LKR 1,124.20 Debited from your A/c XXXXXXXX5891 on 13/09/2026 at 20:50.AvlBal LKR 378,178.93. @ A S P Pharmacy & Grocery Kelaniya. ATM POS Transaction.Thank you for banking with us.Call Centre 1972.';

const WITHDRAWAL =
  'Dear MR M N LAHIRU DILSHAN,LKR 4,000.00 Debited from your A/c XXXXXXXX5891 on 09/09/2026 at 17:23.AvlBal LKR 369,203.13. @ Hatton National Bank HNB MAINETTEC. ATM LankaPay Cash Withdrawal.Thank you for banking with us.Call Centre 1972.';

describe('a POS purchase made at an ATM terminal', () => {
  it('reads the shop as the merchant', () => {
    expect(parseSms(PHARMACY)?.merchant).toBe('A S P Pharmacy & Grocery Kelaniya');
  });

  it('is a PURCHASE, not a cash withdrawal', () => {
    expect(parseSms(PHARMACY)?.kind).toBe('purchase');
  });

  it('still reads the amount and account', () => {
    const parsed = parseSms(PHARMACY);
    expect(parsed?.amountMinor).toBe(112420);
    expect(parsed?.account).toContain('5891');
  });
});

describe('a genuine cash withdrawal in the same format', () => {
  it('is still an ATM withdrawal', () => {
    // The fix must not turn every "@" message into a purchase.
    expect(parseSms(WITHDRAWAL)?.kind).toBe('atm');
  });

  it('reads its location as the merchant', () => {
    expect(parseSms(WITHDRAWAL)?.merchant).toBe('Hatton National Bank HNB MAINETTEC');
  });
});
