import { describe, expect, it } from 'vitest';
import { parseSms } from '~/features/sms/logic/smsParser';

/**
 * An ATM fee is a bank charge, not a cash withdrawal.
 *
 * "LKR 30.00 debited ... as ATM Withdrawal Fee" contains both `ATM` and
 * `withdrawal`, and the ATM rule ran first — so a 30-rupee charge was filed as
 * cash out of a machine and offered to the user as pocket money. Two things had
 * to change: the fee patterns did not allow a qualifier between the noun and
 * the fee word ("ATM **Withdrawal** Fee"), and the fee test had to be tried
 * before the ATM one.
 */
describe('ATM withdrawal fee', () => {
  const fee =
    'LKR 30.00 debited from AC XXXXXXXX6796 on 17 Sep 2026 22:16 as ATM Withdrawal Fee. Avl Bal 112,583.46 Call 94112448888 for info';

  it('is a bank charge, not an ATM withdrawal', () => {
    expect(parseSms(fee)?.kind).toBe('bank_charge');
  });

  it('keeps the fee amount', () => {
    expect(parseSms(fee)?.amountMinor).toBe(3000);
  });

  /*
   * The guard that matters most: a real withdrawal must NOT be swept into
   * bank charges just because the network name carries fee vocabulary.
   */
  it('does not reclassify a genuine withdrawal', () => {
    const withdrawal =
      'LKR 4,500.00 debited from AC XXXXXXXX6796 as ATM TXN on 17 Sep 2026 22:16 at LANKAPAY PAYABLES Hatton National B.Avl Bal 112,583.46';
    expect(parseSms(withdrawal)?.kind).toBe('atm');
  });

  it('still recognises the wording that already worked', () => {
    const cefts =
      'LKR 25.00 debited from AC XXXXXXXX6796 on 13 Sep 2026 15:41 as CEFTS Transfer Charges. Avl Bal 211,236';
    expect(parseSms(cefts)?.kind).toBe('bank_charge');
  });

  it('handles the other qualifier forms banks use', () => {
    const forms = [
      'LKR 50.00 debited as Transfer Service Charge. Avl Bal 1,000.00',
      'LKR 15.00 debited as ATM Enquiry Fee. Avl Bal 1,000.00',
    ];
    for (const message of forms) {
      expect(parseSms(message)?.kind).toBe('bank_charge');
    }
  });

  /*
   * A large debit is never a fee, whatever the wording: the plausibility cap is
   * what stops a misread withdrawal landing on the bank-charges line.
   */
  it('refuses an implausibly large "fee"', () => {
    const big =
      'LKR 85,000.00 debited from AC XXXXXXXX6796 as ATM Withdrawal Fee. Avl Bal 10,000.00';
    expect(parseSms(big)?.kind).not.toBe('bank_charge');
  });
});
