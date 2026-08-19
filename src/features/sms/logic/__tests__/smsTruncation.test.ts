import { describe, expect, it } from 'vitest';
import { looksTruncated, parseSms } from '../smsParser';

/**
 * A Shortcut whose deep link lacks a **URL Encode** action makes iOS truncate
 * the URL at the first unencoded space, so the app receives a fragment. The
 * message simply never appears, with nothing anywhere saying why.
 *
 * This matters most for formats padded with spaces. HNB's POS alert pads its
 * Location field — "BEN FOODS" followed by sixteen spaces — which is exactly
 * the shape that gets clipped, and is the format from a transaction the user
 * lost entirely.
 */
describe('looksTruncated', () => {
  it('recognises an alert clipped before its amount', () => {
    // What arrives when the URL is cut at the first space.
    expect(looksTruncated('HNB SMS ALERT: PURCHASE,')).toBe(true);
    expect(looksTruncated('HNB SMS ALERT: PURCHASE, Debit')).toBe(true);
  });

  it('does NOT flag a complete alert, however padded', () => {
    /*
     * The full BEN FOODS message, spaces and all. It parses fine — so if it
     * ever goes missing the cause is upstream, and calling it truncated would
     * point the user at the wrong fix.
     */
    const full =
      'HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:BEN FOODS                , LK,Amount(Approx.):1010.00 LKR,Av.Bal:391647.29 LKR,Date:05.08.26,Time:06:28, Hot Line:0112462462';

    expect(looksTruncated(full)).toBe(false);
    expect(parseSms(full)).not.toBeNull();
  });

  it('does not flag ordinary complete alerts', () => {
    for (const message of [
      'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN at CEB. Avl Bal 3,043.06',
      'LKR 10,000.00 credited to AC XXXXXXXX6796 as CEFTS Inward Transfer. Avl Bal 13,043.06',
    ]) {
      expect(looksTruncated(message)).toBe(false);
    }
  });

  it('does not flag text that never looked like an alert', () => {
    // A truncated grocery list is not a truncated bank message, and reporting
    // it as one would send the user to fix a Shortcut that is working.
    expect(looksTruncated('Amma called')).toBe(false);
    expect(looksTruncated('Your parcel is out for')).toBe(false);
    expect(looksTruncated('')).toBe(false);
  });

  it('needs enough text to be a fragment at all', () => {
    expect(looksTruncated('HNB')).toBe(false);
  });
});
