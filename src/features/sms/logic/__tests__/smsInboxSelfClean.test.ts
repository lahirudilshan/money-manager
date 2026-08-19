import { describe, expect, it } from 'vitest';
import { isRejectedAsNoise, parseSms } from '../smsParser';

/**
 * The handoff file retains anything the parser could not read, so a parser gap
 * is visible and fixable rather than silently destroying a real transaction.
 *
 * Applied to junk, that same rule turns the file into a junk drawer — which is
 * what happened: the user's inbox accumulated OTPs and marketing blasts, none
 * of which would ever parse, and had to be cleared by hand. `isRejectedAsNoise`
 * is the line between "keep this, we should learn it" and "discard this, we
 * recognised it as not-a-transaction".
 */
describe('isRejectedAsNoise', () => {
  it('discards the junk that was really stuck in the file', () => {
    const junk = [
      'Your one-time password for transaction LKR 2500.00 at CEB is 681854. Call 0112448888 if unauthorized.',
      'Enjoy 30% savings at Cinnamon Lakeside during lunch. Valid till 31st Aug. Max savings LKR 10,000. T&C Apply. For details, visit bit.ly/Amex-Dining',
      'You received LKR 10,000 from DILSHAN M N L\nDo not share OTP & sensitive information with anyone.',
    ];

    for (const message of junk) {
      expect(parseSms(message)).toBeNull();
      expect(isRejectedAsNoise(message)).toBe(true);
    }
  });

  it('discards a message carrying no money wording at all', () => {
    // Not a bank alert the parser failed on — a message about something else
    // that the automation happened to sweep up.
    expect(isRejectedAsNoise('Your parcel is out for delivery today.')).toBe(true);
    expect(isRejectedAsNoise('Amma called, ring her back')).toBe(true);
  });

  it('discards a balance-only report', () => {
    expect(
      isRejectedAsNoise('Your available balance in AC XXXXXXXX6796 is LKR 84,300.15 as at 24 Jul 2026.'),
    ).toBe(true);
  });

  it('RETAINS an unrecognised message that does look like a movement', () => {
    /*
     * The case the retention rule exists for: wording the parser has not
     * learned yet, from a bank it has never seen. It reads as a debit but
     * yields no amount, so it does not parse — and it must stay in the file so
     * the format can be added later rather than being thrown away.
     */
    const unknown = 'Card debited at SOME NEW MERCHANT, ref 99Z. Contact us for details.';

    expect(parseSms(unknown)).toBeNull();
    expect(isRejectedAsNoise(unknown)).toBe(false);
  });

  it('never claims a message that parses fine is noise', () => {
    // A real alert must never be discarded — this is the one dangerous failure
    // mode of self-cleaning, so it is asserted over the whole real timeline.
    const real = [
      'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 00:45 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 3,043.06 Call 94112448888 for info',
      'LKR 10,000.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 11:57 as CEFTS Inward Transfer. Avl Bal 13,043.06 Call 94112448888 for info',
      'LKR 4,270.86 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 11:59 at National Water Supply Rathmalana. Avl Bal 8,772.20 Call 94112448888 for info',
      'LKR 25.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Transfer Charges. Avl Bal 8,747.20 Call 94112448888 for info',
      'LKR 10,000.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Outward Transfer. Avl Bal 8,747.20 Call 94112448888 for info',
      'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 11:57:03 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
    ];

    for (const message of real) {
      expect(parseSms(message)).not.toBeNull();
      expect(isRejectedAsNoise(message)).toBe(false);
    }
  });

  it('is safe on empty and non-string input', () => {
    expect(isRejectedAsNoise('')).toBe(false);
    expect(isRejectedAsNoise('   ')).toBe(false);
    expect(isRejectedAsNoise(undefined as unknown as string)).toBe(false);
  });
});
