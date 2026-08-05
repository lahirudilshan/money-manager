import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';

/**
 * The messages that were REALLY stuck in the user's inbox file on 2026-08-04,
 * pulled off the device with `devicectl device copy from`.
 *
 * Every one of these was rejected by the parser and therefore retained in the
 * file forever, and each is a distinct class of noise. They are reproduced
 * verbatim (only the OTP codes are as-received) because paraphrasing them is
 * how a regression sneaks back in — the exact wording is the test.
 */
describe('junk messages that must never become transactions', () => {
  it('rejects an OTP whose code trails the amount', () => {
    /*
     * The shape that beat every earlier OTP pattern: the message announces
     * itself as a password FOR a transaction and puts the code at the end, so
     * neither "<code> is your OTP" nor "your OTP is <code>" matched. It parsed
     * as a 2,500.00 debit at CEB — duplicating the real POS alert for the same
     * payment, so the user saw their electricity bill twice.
     */
    expect(
      parseSms(
        'Your one-time password for transaction LKR 2500.00 at CEB is 681854. Call 0112448888 if unauthorized.',
      ),
    ).toBeNull();

    expect(
      parseSms(
        'Your one-time password for transaction LKR 4270.86 at National W is 481399. Call 0112448888 if unauthorized.',
      ),
    ).toBeNull();
  });

  it('rejects a marketing blast that quotes an LKR amount', () => {
    // "Max savings LKR 10,000" is a currency amount in a message about no
    // transaction whatsoever. This is the "promo junk containing LKR" the user
    // reported polluting the inbox.
    expect(
      parseSms(
        'Enjoy 30% savings at Cinnamon Lakeside - Long Feng during lunch and 20% at ITC Ratnadipa during lunch & dinner #WithAmex. Valid till 31st Aug. Max savings LKR 10,000. T&C Apply. For details, visit bit.ly/Amex-Dining\n\n*StopAd? SMS BL NTBAmexPrmo to 9010*',
      ),
    ).toBeNull();
  });

  it('rejects a peer-to-peer notification that names no account', () => {
    /*
     * A genuine event, but the same money ALSO arrives as a proper CEFTS credit
     * alert on the account — so drafting both counts the income twice. The
     * discriminator is that this names no account the app can tie it to.
     */
    expect(
      parseSms(
        'You received LKR 10,000 from DILSHAN M N L\nOTP අංකය හෝ රහස්‍ය තොරතුරු කිසිවෙකුටවත් ලබා නොදෙන්න.\nDo not share OTP & sensitive information with anyone.',
      ),
    ).toBeNull();
  });

  it('still accepts a real credit that DOES name an account', () => {
    // The guard above must not swallow the legitimate alert for the same money.
    const parsed = parseSms(
      'LKR 10,000.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 11:57 as CEFTS Inward Transfer. Avl Bal 13,043.06 Call 94112448888 for info',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe('credit');
    expect(parsed!.amountMinor).toBe(1_000_000);
  });

  it('does not treat a scam-warning in a real alert as an OTP delivery', () => {
    // HNB stamps "DO NOT SHARE ACCOUNT DETAILS /OTP" on every genuine alert.
    // Rejecting on the mere word "OTP" would delete real transactions.
    const parsed = parseSms(
      'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 11:57:03 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.amountMinor).toBe(1_002_500);
  });
});

describe('HNB "Reason:MB:ref" alerts', () => {
  const HNB =
    'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 11:57:03 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462';

  it('does not read the balance as the merchant', () => {
    // Was "Bal:LKR 405,757" — the `ref:` extractor ran past the empty reference
    // and swallowed the balance, naming the bill after the user's own balance.
    expect(parseSms(HNB)!.merchant).toBe('');
  });

  it('classifies a merchant-less mobile-banking debit as a transfer', () => {
    // Carries no transfer vocabulary at all, yet both halves of the user's real
    // HNB->NDB transfers look like this. While it was 'other' it could never
    // pair with the NDB credit, so every top-up counted as spend AND income.
    expect(parseSms(HNB)!.kind).toBe('transfer_out');
  });

  it('keeps the visible account tail even though it is too short to match a card', () => {
    // "Ac No:13802XXXXX50" reveals only "50". Useless as a card key, but it
    // still distinguishes this account from the NDB one when pairing.
    expect(parseSms(HNB)!.account).toBe('50');
  });
});

describe('bank fees', () => {
  it('classifies a CEFTS charge as a bank charge, not a transfer', () => {
    // Contains the word "Transfer", so the transfer rule used to claim it —
    // which both asked the user to categorise a 25-rupee fee and made it
    // eligible for internal-transfer cancellation.
    const parsed = parseSms(
      'LKR 25.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Transfer Charges. Avl Bal 8,747.20 Call 94112448888 for info',
    );
    expect(parsed!.kind).toBe('bank_charge');
    expect(parsed!.amountMinor).toBe(2_500);
  });

  it('does not mistake a real outward transfer for a fee', () => {
    const parsed = parseSms(
      'LKR 10,000.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Outward Transfer. Avl Bal 8,747.20 Call 94112448888 for info',
    );
    expect(parsed!.kind).toBe('transfer_out');
  });
});
