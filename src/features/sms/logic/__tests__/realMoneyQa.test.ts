import { describe, expect, it } from 'vitest';
import { cancelReversals } from '../smsInbox';
import { parseSms, reversedCharge, type ParsedSms } from '../smsParser';
import { accountLabelFor, reconcileSms, type BoardSlice } from '../smsReconcile';
import { accountFragmentOf } from '../accountMasks';
import { buildLedgers, type LedgerInput } from '~/features/accounts/logic/accountLedger';

/**
 * Money-correctness regressions found by running the app over a copy of the
 * user's real phone database (2026-11-09). Every message here is verbatim from
 * that device.
 */

const ndb = (body: string) => `${body} Call 94112448888 for info`;
const parse = (raw: string): ParsedSms => {
  const parsed = parseSms(raw);
  if (!parsed) throw new Error(`did not parse: ${raw}`);
  return parsed;
};

describe('a failed transaction and its reversal cancel, whatever order they arrive in', () => {
  // Delivered to the phone in THIS order, in one batch, on 08 Nov.
  const reversal = parse(ndb('A reversal for CEFTS Outward Transfer of LKR 1,500.00 credited to AC XXXXXXXX6796 on 08 Nov 2026 12:12. Avl Bal 175,491.28'));
  const failed = parse(ndb('LKR 1,500.00 debited from AC XXXXXXXX6796 on 08 Nov 2026 12:12 as CEFTS Outward Transfer. Avl Bal 175,491.28'));
  const retry = parse(ndb('LKR 1,500.00 debited from AC XXXXXXXX6796 on 08 Nov 2026 12:13 as CEFTS Outward Transfer. Avl Bal 173,966.28'));

  it('pairs a reversal with a debit of the same minute that arrived after it', () => {
    expect(cancelReversals([reversal, failed, retry])).toEqual([retry]);
  });

  it('never consumes a later-minute debit — that is the real retry', () => {
    expect(cancelReversals([reversal, retry])).toEqual([reversal, retry]);
  });
});

describe('a reversal of a charge already logged is offered as that charge’s refund', () => {
  const board: BoardSlice = {
    subcategories: [
      { id: 'fees', name: 'Bank charges', type: 'expense', categoryId: 'bank', plannedMinor: 0, cardId: null } as never,
      { id: 'cash', name: 'Cash / pocket money', type: 'expense', categoryId: 'living', plannedMinor: 0, cardId: null } as never,
    ],
    categories: [
      { id: 'bank', name: 'Bank & fees', cardId: null } as never,
      { id: 'living', name: 'Living', cardId: null } as never,
    ],
    cards: [],
  };

  it('reads the charge back out of the reversal', () => {
    const fee = parse(ndb('A reversal for ATM Withdrawal Fee of LKR 30.00 credited to AC XXXXXXXX6796 on 07 Nov 2026 15:37. Avl Bal 206,346.28'));
    expect(reversedCharge(fee)).toMatchObject({ direction: 'debit', kind: 'bank_charge', merchant: 'ATM Withdrawal Fee', amountMinor: 3000 });
  });

  it('suggests the Bank charges line, and keeps the credit so confirm logs it negative', () => {
    const fee = parse(ndb('A reversal for CEFTS Transfer Charges of LKR 25.00 credited to AC XXXXXXXX6796 on 07 Nov 2026 16:50. Avl Bal 201,316.28'));
    const draft = reconcileSms(fee, board, 'x');
    expect(draft.subcategoryId).toBe('fees');
    expect(draft.parsed.direction).toBe('credit');
    expect(draft.parsed.kind).toBe('reversal');
  });
});

describe('the review card names the account the money really moves', () => {
  const cards = [
    { id: 'expenses', nickname: 'Expenses', bankName: 'Hatton National Bank', last4: '4150', accountNumber: '138020174150' },
    { id: 'salary', nickname: 'Salary', bankName: 'DFCC Bank', last4: '5584', accountNumber: '102060635584', foreignAccountNumber: '102007417427', foreignLast4: '7427', foreignCurrency: 'USD' },
  ];

  it('HNB masked "13802XXXXX50" is Expenses, not "••50"', () => {
    const p = parse('LKR 4.05 credited to Ac No:13802XXXXX50 on 24/10/26 21:19:35 Reason:13802XXXXX50:Int.Pd:28-09-2026 to 24-10-2026 Bal:LKR 3,039.69 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462');
    expect(accountLabelFor(accountFragmentOf(p), cards)).toBe('Hatton National Bank Expenses ••4150');
  });

  it('DFCC USD ...7427 is the Salary card’s USD leg', () => {
    const p = parse('Your A/C No: ********7427 is credited with USD5.51 on 26 OCT 2026 ref: Interest Capitalise. Your bal is USD5,212.67. If unauthorized call 0112350035.');
    expect(accountLabelFor(accountFragmentOf(p), cards)).toBe('DFCC Bank Salary ••7427 USD');
  });
});

describe('a payment on a card’s foreign-currency leg leaves the rupee balance alone', () => {
  const input = (cardLeg: string | null): LedgerInput => ({
    accounts: [{ id: 'salary', openingBalanceMinor: 100_000, startPeriod: '2026-10' }],
    lines: [{ id: 'cash', name: 'Cash', type: 'expense', frequency: 'ongoing', plannedMinor: 0, planTargetMinor: null, onceInPeriod: null, createdAt: new Date('2026-10-01'), cardId: 'salary' }],
    states: [],
    // USD 1,800 converted: Rs 589,950.
    transactions: [{ id: 't', subcategoryId: 'cash', period: '2026-10', name: 'Transfer Debit', amountMinor: 58_995_000, date: new Date(2026, 9, 30), cardId: 'salary', cardLeg }],
    transfers: [],
    incomes: [],
    sourceCardId: null,
    currentPeriod: '2026-11',
    toAccount: (m) => m,
    toHome: (m) => m,
  });

  it('skips it on the foreign leg', () => {
    expect(buildLedgers(input('foreign')).get('salary')!.balanceMinor).toBe(100_000);
  });

  it('still debits the primary leg', () => {
    expect(buildLedgers(input(null)).get('salary')!.balanceMinor).toBe(100_000 - 58_995_000);
  });
});
