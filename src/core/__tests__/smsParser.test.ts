import { describe, expect, it } from 'vitest';
import samplesFile from '../../data/sms-samples.json';
import { parseSms } from '../smsParser';

/**
 * The parser is validated against src/data/sms-samples.json — the same file the
 * user edits with real messages. Each sample declares either the fields it must
 * extract or `expect: null` for a message that must be ignored (OTP, promo,
 * balance-only). Replacing a sample's `raw` with a real SMS and running the
 * suite immediately shows whether the parser still handles it.
 */

interface SampleExpect {
  direction: string;
  kind: string;
  amountMinor: number;
  merchant: string;
  account: string;
  date: string | null;
  /** Optional: only asserted on samples that declare it (foreign-currency ones). */
  currency?: string | null;
}

interface Sample {
  id: string;
  source: string;
  raw: string;
  expect: SampleExpect | null;
}

const samples = samplesFile.samples as Sample[];

describe('parseSms over sms-samples.json', () => {
  for (const sample of samples) {
    it(sample.id, () => {
      const result = parseSms(sample.raw);

      if (sample.expect === null) {
        expect(result).toBeNull();
        return;
      }

      expect(result).not.toBeNull();
      expect(result!.direction).toBe(sample.expect.direction);
      expect(result!.kind).toBe(sample.expect.kind);
      expect(result!.amountMinor).toBe(sample.expect.amountMinor);
      expect(result!.merchant).toBe(sample.expect.merchant);
      expect(result!.account).toBe(sample.expect.account);
      expect(result!.date).toBe(sample.expect.date);
      if (sample.expect.currency !== undefined) {
        expect(result!.currency).toBe(sample.expect.currency);
      }
    });
  }
});

describe('parseSms robustness', () => {
  it('returns null for empty or non-string input', () => {
    expect(parseSms('')).toBeNull();
    expect(parseSms('   ')).toBeNull();
    // @ts-expect-error deliberately wrong type
    expect(parseSms(null)).toBeNull();
  });

  it('never reads the trailing available balance as the amount', () => {
    const result = parseSms(
      'Your Card ending 1234 was debited LKR 500.00 at SHOP on 01/07/2026. Avl Bal LKR 99,999.00',
    );
    expect(result?.amountMinor).toBe(50_000);
  });

  it('keeps amounts as positive minor units regardless of direction', () => {
    const credit = parseSms('Your account 12 has been credited with Rs.1,000.00 on 01/07/2026');
    expect(credit?.amountMinor).toBe(100_000);
    expect(credit?.direction).toBe('credit');
  });

  it('preserves cents, including a trailing-zero .40', () => {
    const water = parseSms(
      'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 at Water. Avl Bal 1.00',
    );
    expect(water?.amountMinor).toBe(286_740);

    const sub = parseSms(
      'LKR 7,027.41 debited from AC XXXXXXXX6796 as POS TXN on 20 Jul 2026 at ANTHROPIC. Avl Bal 1.00',
    );
    expect(sub?.amountMinor).toBe(702_741);
  });

  it('reads the withdrawal amount, never the transaction fee', () => {
    const result = parseSms(
      'HNB ATM Withdrawal e-Receipt\nAmt(Approx.): 85000.00 LKR\nTxn Fee: 30.00LKR\nAvl Bal: 640099.67 LKR',
    );
    expect(result?.amountMinor).toBe(8_500_000);
    expect(result?.kind).toBe('atm');
  });

  it('does not mistake a scam-warning "/OTP" in a real payment for an OTP delivery', () => {
    const result = parseSms(
      'LKR 180,025.00 debited to Ac No:13802XXXXX50 on 24/07/26 Reason:MB:loan-AML08 DO NOT SHARE ACCOUNT DETAILS /OTP',
    );
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('loan_payment');
  });

  it('still ignores a genuine OTP delivery message', () => {
    expect(parseSms('452123 is your OTP for a payment of LKR 3,000.00')).toBeNull();
  });
});

describe('parseSms currency handling', () => {
  it('reads a glued foreign code, e.g. "USD2,500.00"', () => {
    const result = parseSms(
      'Your A/C No: ********7427 is credited with USD2,500.00 on 31 JUL 2026 ref: Inward SWIFT Payment. Your bal is USD5,002.26.',
    );
    expect(result?.amountMinor).toBe(250_000);
    expect(result?.currency).toBe('USD');
  });

  it('never reads the trailing "Your bal is" figure as the amount', () => {
    const result = parseSms(
      'Your A/C No: ********7427 is credited with USD2,500.00 on 31 JUL 2026 ref: Inward SWIFT Payment. Your bal is USD5,002.26.',
    );
    // 5,002.26 would be 500226 minor — proving the balance clause was skipped.
    expect(result?.amountMinor).not.toBe(500_226);
  });

  it.each([
    ['EUR 1,200.50', 'EUR', 120_050],
    ['GBP899.99', 'GBP', 89_999],
    ['1,500.00 AED', 'AED', 150_000],
    ['SGD 340.25', 'SGD', 34_025],
  ])('handles %s', (amountText, currency, minor) => {
    const result = parseSms(`Your account 1234 is credited with ${amountText} on 01 Jul 2026`);
    expect(result?.currency).toBe(currency);
    expect(result?.amountMinor).toBe(minor);
  });

  it('reports null currency for a bare "Rs." with no ISO code', () => {
    const result = parseSms('Your account 12 has been credited with Rs.1,000.00 on 01/07/2026');
    expect(result?.currency).toBeNull();
    expect(result?.amountMinor).toBe(100_000);
  });

  it('does not mistake a bare three-letter word for a currency code', () => {
    // "LKA" (the country code in an ATM location) must not claim the amount.
    const result = parseSms(
      'LKR 500.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 at SHOP LKA 999. Avl Bal 1.00',
    );
    expect(result?.amountMinor).toBe(50_000);
    expect(result?.currency).toBe('LKR');
  });

  it('classifies an inward SWIFT payment as money arriving', () => {
    const result = parseSms(
      'Your A/C No: ********7427 is credited with USD2,500.00 on 31 JUL 2026 ref: Inward SWIFT Payment.',
    );
    expect(result?.direction).toBe('credit');
    expect(result?.kind).toBe('transfer_in');
  });
});

describe('parseSms time extraction', () => {
  it('reads a labelled "Time:" and ignores the trailing hot line digits', () => {
    const result = parseSms(
      'HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:KEELLS SUPER - SINHARAMUL, LK,Amount(Approx.):3747.40 LKR,Av.Bal:636012.27 LKR,Date:22.07.26,Time:20:54, Hot Line:0112462462',
    );
    expect(result?.time).toBe('20:54');
    expect(result?.date).toBe('2026-07-22');
  });

  it('reads an unlabelled clock time', () => {
    const result = parseSms(
      'LKR 500.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 09:05 at SHOP. Avl Bal 1.00',
    );
    expect(result?.time).toBe('09:05');
  });

  it('drops seconds rather than showing them', () => {
    const result = parseSms(
      'LKR 500.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 at 18:30:47 SHOP. Avl Bal 1.00',
    );
    expect(result?.time).toBe('18:30');
  });

  it('is null when the message carries no time', () => {
    const result = parseSms(
      'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 at Water. Avl Bal 1.00',
    );
    expect(result?.time).toBeNull();
  });

  it('rejects digit runs that are not a valid clock reading', () => {
    const result = parseSms(
      'LKR 500.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 at SHOP ref 99:88. Avl Bal 1.00',
    );
    expect(result?.time).toBeNull();
  });
});
