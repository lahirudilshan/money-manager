import { describe, expect, it } from 'vitest';
import { isRejectedAsNoise, parseSms } from '../smsParser';

/**
 * The four messages actually stuck in the user's handoff file on 2026-09-01.
 *
 * Per `docs`, whatever is left in `temp-sms-inbox.txt` IS the parser's gap
 * list — the file retains anything unreadable so the format can be learned
 * later. These four had sat there long enough for the user to ask why the file
 * never empties, and between them they expose three separate faults, not one:
 *
 *   1. A security-awareness blast retained because the phrase "fake traffic
 *      fine payment links" contains the word "payment". `MOVEMENT_WORDING`
 *      asks only "does this text claim money moved", and a warning ABOUT
 *      payments is not a payment. Nothing about it will ever parse, so it
 *      stays forever — and it arrived twice.
 *   2. A real ATM cash deposit the classifier scores a perfect 1.0 on and
 *      `parseSms` still returns null for. That is a genuine parser gap, and
 *      the retention rule is doing its job by keeping it.
 *   3. A real credit-card payment confirmation that scores 0.25 — under the
 *      accept threshold — because it says "payment ... made to Card #" with no
 *      verb the scorer recognises as movement.
 *
 * Only the first should ever be discarded. The other two are money that never
 * reached the board, so they must be RETAINED until parsed, never swept away.
 */

/** Verbatim from the device, including the curly apostrophe. */
const SECURITY_ALERT =
  'DFCC Bank Security Alert: Beware of fake traffic fine payment links currently being circulated. Don’t click or share your details. Use official banking channels only. Pause. Think. Verify.';

const ATM_DEPOSIT =
  'Dear MR M N LAHIRU DILSHAN,LKR 5,000.00 Credited to your A/c XXXXXXXX5891 on 27/08/2026 at 09:32.AvlBal LKR 310,158.83.Transaction ATM Cash Deposit.Thank you for banking with us.Call Centre 1972.';

const CARD_PAYMENT =
  'Thank you for your payment of LKR 46,567.00 made to Card # 376657*****3055 on 28-08-2026.';

describe('the real leftovers in temp-sms-inbox.txt', () => {
  describe('the security blast — junk that must self-clean', () => {
    it('is not a transaction', () => {
      expect(parseSms(SECURITY_ALERT)).toBeNull();
    });

    it('is DISCARDED, so it stops accumulating in the file', () => {
      // The actual regression. "payment" appears inside "fake traffic fine
      // payment links" — a warning about payments, not a payment.
      expect(isRejectedAsNoise(SECURITY_ALERT)).toBe(true);
    });

    it('discards the other awareness blasts of the same shape', () => {
      const blasts = [
        'Beware of fraudulent calls asking for your PIN or OTP. Bank staff will never request these details.',
        'Security Notice: Do not share your card details on unverified websites. Report suspicious transfers to 1972.',
        'Alert: Phishing links claiming a refund is pending are circulating. Never click them.',
      ];

      for (const blast of blasts) {
        expect(parseSms(blast)).toBeNull();
        expect(isRejectedAsNoise(blast)).toBe(true);
      }
    });
  });

  describe('the real transactions — money that must NOT be swept away', () => {
    it('parses the ATM cash deposit as a LKR 5,000 credit', () => {
      const parsed = parseSms(ATM_DEPOSIT);
      expect(parsed).not.toBeNull();
      expect(parsed?.direction).toBe('credit');
      expect(parsed?.amountMinor).toBe(500_000);
    });

    it('parses the card payment as a LKR 46,567 debit', () => {
      const parsed = parseSms(CARD_PAYMENT);
      expect(parsed).not.toBeNull();
      expect(parsed?.amountMinor).toBe(4_656_700);
    });

    it('never discards either of them as noise', () => {
      // The one dangerous failure mode of a self-cleaning file: real money
      // recognised as junk and destroyed with no copy anywhere.
      expect(isRejectedAsNoise(ATM_DEPOSIT)).toBe(false);
      expect(isRejectedAsNoise(CARD_PAYMENT)).toBe(false);
    });
  });

  it('still retains genuinely unknown movement wording', () => {
    // The narrowing must not overshoot: an unparseable message that really
    // does claim money moved is still evidence of a parser gap.
    const unknown = 'Card debited at SOME NEW MERCHANT, ref 99Z. Contact us for details.';
    expect(parseSms(unknown)).toBeNull();
    expect(isRejectedAsNoise(unknown)).toBe(false);
  });
});
