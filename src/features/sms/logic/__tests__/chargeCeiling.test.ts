import { describe, expect, it } from 'vitest';
import { parseSms, MAX_PLAUSIBLE_CHARGE_MINOR, type ParsedSms } from '~/features/sms/logic/smsParser';
import { reconcileSms } from '~/features/sms/logic/smsReconcile';

const BOARD = {
  subcategories: [
    { id: 'bc', name: 'Bank charges', categoryId: 'bf', type: 'expense', plannedMinor: 0 },
    { id: 'groc', name: 'Groceries', categoryId: 'liv', type: 'expense', plannedMinor: 0 },
  ],
  categories: [{ id: 'bf', name: 'Bank & fees' }, { id: 'liv', name: 'Living' }],
  cards: [],
} as never;

/**
 * A bank charge is small. Everything else follows from that.
 *
 * Stated as an invariant over every path rather than a fix to whichever branch
 * last produced a wrong row: the keyword classifier, the itemised-fee split and
 * the stored-row rebuild each did so independently, which is why fixing them
 * one at a time did not hold.
 */
describe('no path may produce a large bank charge', () => {
  it('the ceiling is a small amount', () => {
    expect(MAX_PLAUSIBLE_CHARGE_MINOR).toBeLessThanOrEqual(100_000); // <= 1,000 LKR
  });

  it.each([
    ['ATM receipt', 'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  10000.00 LKR\nA/C: 1380***4150\nTxn Fee: 30.00LKR'],
    ['9,000 CEFTS wording', 'Your A/C 1380***4150 debited LKR 9,000.00 for CEFTS Transfer Charges. Avl Bal LKR 12,345.00'],
    ['4,000 with charges applied', 'Cash withdrawal LKR 4,000.00. Charges applied LKR 25.00. Bal LKR 5,000.00'],
    ['10,000 transfer naming a charge', 'LKR 10,000.00 transferred to A/C 123. Transfer charge LKR 50.00 debited.'],
  ])('%s is never parsed as a bank charge', (_label, raw) => {
    const parsed = parseSms(raw);
    if (!parsed) return;
    if (parsed.kind === 'bank_charge') {
      expect(parsed.amountMinor).toBeLessThanOrEqual(MAX_PLAUSIBLE_CHARGE_MINOR);
    }
  });

  /**
   * The path that kept the bug alive on the device: a row whose text the parser
   * cannot read is rebuilt from its STORED columns, which carry whatever an
   * older build wrote. Nothing re-examines it, so a stale `bank_charge` at
   * 10,000 proposes the charges line forever.
   */
  it.each([1_000_000, 900_000, 400_000])(
    'a stale stored bank_charge of %i minor never targets the charges line',
    (amountMinor) => {
      const stale: ParsedSms = {
        direction: 'debit',
        kind: 'bank_charge',
        amountMinor,
        currency: 'LKR',
        merchant: 'HNB ATM Withdrawal',
        account: '4150',
        date: '2026-08-06',
        time: '12:24',
        raw: 'unreadable by the current parser',
      };
      const draft = reconcileSms(stale, BOARD, 'id');
      expect(draft.subcategoryId).not.toBe('bc');
    },
  );

  it('a genuine small fee still lands on the charges line', () => {
    const parsed = parseSms('Your A/C 4150 debited LKR 25.00 as CEFTS Transfer Charges. Bal LKR 1,000.00')!;
    expect(parsed.kind).toBe('bank_charge');
    expect(reconcileSms(parsed, BOARD, 'id').subcategoryId).toBe('bc');
  });
});
