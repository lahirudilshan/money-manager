import { describe, expect, it } from 'vitest';
import { decodeSmsParam, extractSmsFromUrl, looksTruncated } from '../smsIntakeUrl';
import { parseSms } from '../smsParser';

const SMS =
  'Your Card ending 1234 was debited LKR 12,500.00 at KEELLS SUPER on 24/07/2026. Avl Bal 45,000.00';

describe('decodeSmsParam', () => {
  it('decodes a correctly encoded message', () => {
    expect(decodeSmsParam(encodeURIComponent(SMS))).toBe(SMS);
  });

  it('passes through a message that was never encoded', () => {
    expect(decodeSmsParam(SMS)).toBe(SMS);
  });

  it('recovers a double-encoded message', () => {
    expect(decodeSmsParam(encodeURIComponent(encodeURIComponent(SMS)))).toBe(SMS);
  });

  it('does not throw on a stray percent sign', () => {
    const text = 'Loan at 5% interest debited LKR 1,000.00';
    expect(decodeSmsParam(text)).toBe(text);
  });

  it('treats + as space only when there are no real spaces', () => {
    expect(decodeSmsParam('debited+LKR+500.00+at+SHOP')).toBe('debited LKR 500.00 at SHOP');
  });

  it('keeps a literal + when the text already has spaces', () => {
    const text = 'Payment A + B debited LKR 500.00';
    expect(decodeSmsParam(text)).toBe(text);
  });

  it('trims surrounding whitespace', () => {
    expect(decodeSmsParam('%20%20hello%20%20')).toBe('hello');
  });
});

describe('extractSmsFromUrl', () => {
  it('extracts a properly encoded deep link', () => {
    const url = `moneymanager://sms?text=${encodeURIComponent(SMS)}`;
    expect(extractSmsFromUrl(url)).toBe(SMS);
  });

  it('extracts an unencoded deep link (the common Shortcut mistake)', () => {
    expect(extractSmsFromUrl(`moneymanager://sms?text=${SMS}`)).toBe(SMS);
  });

  it('keeps the whole message when it contains an ampersand', () => {
    const text = 'debited LKR 500.00 at M&S FOOD on 24/07/2026';
    expect(extractSmsFromUrl(`moneymanager://sms?text=${text}`)).toBe(text);
  });

  it('keeps the whole message when it contains a hash', () => {
    const text = 'debited LKR 500.00 at SHOP #12 on 24/07/2026';
    expect(extractSmsFromUrl(`moneymanager://sms?text=${text}`)).toBe(text);
  });

  it('handles text= appearing as a later parameter', () => {
    expect(extractSmsFromUrl('moneymanager://sms?src=auto&text=hello%20world')).toBe('hello world');
  });

  it('returns null when there is no text parameter', () => {
    expect(extractSmsFromUrl('moneymanager://sms')).toBeNull();
  });

  it('returns null for an empty text parameter', () => {
    expect(extractSmsFromUrl('moneymanager://sms?text=')).toBeNull();
  });

  it('returns null for an empty url', () => {
    expect(extractSmsFromUrl('')).toBeNull();
  });

  /** The point of all of the above: every delivery shape must still parse. */
  it.each([
    ['encoded', `moneymanager://sms?text=${encodeURIComponent(SMS)}`],
    ['unencoded', `moneymanager://sms?text=${SMS}`],
    ['double-encoded', `moneymanager://sms?text=${encodeURIComponent(encodeURIComponent(SMS))}`],
  ])('yields a parseable transaction from a %s link', (_label, url) => {
    const text = extractSmsFromUrl(url)!;
    const parsed = parseSms(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.amountMinor).toBe(1_250_000);
    expect(parsed!.merchant).toContain('KEELLS SUPER');
    expect(parsed!.date).toBe('2026-07-24');
  });
});

describe('real Shortcut URL shapes', () => {
  const SMS =
    'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:11 at National Water Supply Rathmalana. Avl Bal 174,121.03';

  it('accepts a case-variant text parameter', () => {
    // A hand-built Shortcut easily produces `Text=`; rejecting it looked
    // exactly like the deep link never firing.
    expect(extractSmsFromUrl(`moneymanager://sms?TEXT=${encodeURIComponent(SMS)}`)).toBe(SMS);
    expect(extractSmsFromUrl(`moneymanager://sms?Text=${encodeURIComponent(SMS)}`)).toBe(SMS);
  });

  it('accepts the host-less triple-slash form', () => {
    expect(extractSmsFromUrl(`moneymanager:///sms?text=${encodeURIComponent(SMS)}`)).toBe(SMS);
  });

  it('accepts a trailing slash before the query', () => {
    expect(extractSmsFromUrl(`moneymanager://sms/?text=${encodeURIComponent(SMS)}`)).toBe(SMS);
  });

  it('still returns null when there is genuinely no text parameter', () => {
    expect(extractSmsFromUrl('moneymanager://sms')).toBeNull();
    expect(extractSmsFromUrl('moneymanager://sms?other=1')).toBeNull();
  });

  it('does not match a parameter that merely ends in "text"', () => {
    // `?context=` must not be mistaken for `?text=`.
    expect(extractSmsFromUrl('moneymanager://sms?context=abc')).toBeNull();
  });
});

/**
 * Truncation detection, built from a VERIFIED device capture rather than a
 * guess: an unencoded 208-character link arrived on an iPhone 13 Pro as 51
 * characters ending at "HNB", while the encoded form arrived complete.
 */
describe('looksTruncated', () => {
  it('flags the doubled-scheme case seen on device', () => {
    expect(looksTruncated('moneymanager://sms?text=HNB')).toBe(true);
  });

  it('flags a bare first word', () => {
    expect(looksTruncated('HNB')).toBe(true);
    expect(looksTruncated('Your')).toBe(true);
  });

  it('does NOT flag the full message', () => {
    expect(
      looksTruncated(
        'HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:KEELLS SUPER - SINHARAMUL, LK,Amount(Approx.):7362.18 LKR',
      ),
    ).toBe(false);
  });

  it('does NOT flag a short but complete message', () => {
    // Unparseable, but it did arrive whole — the parser owns this case.
    expect(looksTruncated('Bal: 1.00')).toBe(false);
  });
});
