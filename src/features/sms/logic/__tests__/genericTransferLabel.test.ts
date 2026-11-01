import { describe, expect, it } from 'vitest';
import {
  isGenericTypeLabel,
  matchMerchant,
  planRuleUpsert,
  transferAmountKey,
  type MerchantRule,
} from '../merchantRules';
import { parseSms } from '../smsParser';
import { reconcileSms, type BoardSlice } from '../smsReconcile';

/**
 * From the user's device, 2026-10: ten confirmations of "CEFTS Outward
 * Transfer" taught the rule "cefts outward transfer → Weligama home" at `exact`
 * confidence, after which rent, a sister's allowance and a vehicle payment were
 * all offered as Weligama home. The label names the mechanism, never a payee.
 */

const line = (id: string, name: string, categoryId: string, plannedMinor: number, extra: object = {}) => ({
  id,
  name,
  type: 'expense' as const,
  plannedMinor,
  categoryId,
  cardId: null,
  loanId: null,
  ...extra,
});

const board: BoardSlice = {
  subcategories: [
    line('rent', 'Rent / mortgage', 'living', 3_500_000),
    line('cash', 'Cash / pocket money', 'living', 0),
    line('weligama', 'Weligama home', 'houses', 1_500_000),
    line('medicine', 'Medicine', 'health', 1_000_000),
    line('lease', 'NDB Lease', 'debt', 12_286_659, { loanId: 'loan-lease' }),
  ],
  categories: [
    { id: 'living', name: 'Living', cardId: null },
    { id: 'houses', name: 'Houses', cardId: null },
    { id: 'health', name: 'Health', cardId: null },
    { id: 'debt', name: 'Debt', cardId: null },
  ],
  cards: [],
};

const poisoned: MerchantRule = {
  id: 'r1',
  pattern: 'cefts outward transfer',
  subcategoryId: 'weligama',
  hint: 'transfer',
  source: 'learned',
  hitCount: 10,
  updatedAt: 1,
};

const transfer = (amount: string) =>
  parseSms(
    `LKR ${amount} debited from AC XXXXXXXX6796 on 02 Oct 2026 10:34 as CEFTS Outward Transfer. Avl Bal 278,830.18 Call 94112448888 for info`,
  )!;

describe('isGenericTypeLabel', () => {
  it.each(['CEFTS Outward Transfer', 'Outward CEFT Transfer', 'Transfer Out', 'Credit Transfer', 'transfer debit'])(
    'treats "%s" as a mechanism, not a payee',
    (label) => expect(isGenericTypeLabel(label)).toBe(true),
  );

  it.each(['Transfer House Colombo', 'KEELLS SUPER', 'Loan Repayment', 'HNB ATM Withdrawal'])(
    'keeps "%s" as a real name',
    (label) => expect(isGenericTypeLabel(label)).toBe(false),
  );
});

describe('learning from a generic transfer', () => {
  it('refuses to learn a rule from the label', () => {
    expect(planRuleUpsert('CEFTS Outward Transfer', 'weligama', 'transfer', [])).toBeNull();
  });

  it('ignores a rule already learned from one', () => {
    expect(matchMerchant('CEFTS Outward Transfer', [poisoned]).subcategoryId).toBeNull();
  });

  it('suggests nothing for an unidentifiable transfer, rather than a confident wrong line', () => {
    const draft = reconcileSms(transfer('11,000.00'), board, 'd', [poisoned]);
    expect(draft.subcategoryId).toBe('');
    expect(draft.confidence).toBe('unknown');
  });

  it('still matches a transfer by its planned amount', () => {
    expect(reconcileSms(transfer('35,000.00'), board, 'd', [poisoned]).subcategoryId).toBe('rent');
  });
});

describe('amounts and spellings from real messages', () => {
  it('matches an installment the bank rounded to the rupee', () => {
    const lease = parseSms(
      'LKR 122,867.00 debited from AC XXXXXXXX6796 on 01 Oct 2026 06:03 as Transfer Out. Avl Bal 290,240.18 Call 94112448888 for info',
    )!;
    expect(reconcileSms(lease, board, 'd').subcategoryId).toBe('lease');
  });

  it('reads the bank’s "PHARAMACY" as a pharmacy', () => {
    const shop = parseSms(
      'LKR 1,163.22 debited from AC XXXXXXXX6796 as POS TXN on 08 Oct 2026 11:25 at SANEEPA PHARAMACY AND GROKELANIYA. Avl Bal 230,978.84 Call 94112448888 for info',
    )!;
    expect(reconcileSms(shop, board, 'd').subcategoryId).toBe('medicine');
  });
});

describe('a payee-less transfer remembered by its amount', () => {
  it('suggests the line the same amount from the same account went to before', () => {
    const remembered: MerchantRule = {
      id: 'r2',
      pattern: transferAmountKey('6796', 1_100_000),
      subcategoryId: 'weligama',
      hint: null,
      source: 'learned',
      hitCount: 2,
      updatedAt: 1,
    };
    const again = reconcileSms(transfer('11,000.00'), board, 'd', [remembered]);
    expect(again.subcategoryId).toBe('weligama');
    // Never a one-tap certainty: another payee could share the sum.
    expect(again.confidence).toBe('likely');
    // A different amount is not that transfer.
    expect(reconcileSms(transfer('12,000.00'), board, 'd', [remembered]).subcategoryId).toBe('');
  });
});

describe('wording from the user’s real banks', () => {
  const withIncome: BoardSlice = {
    ...board,
    subcategories: [
      ...board.subcategories,
      { ...line('interest', 'Interest', 'income', 0), type: 'income' as const },
      line('charges', 'Bank charges', 'fees', 0),
      line('fuel', 'Fuel', 'transport', 2_000_000),
      line('cash2', 'Cash / pocket money', 'living', 1_000_000),
    ],
    categories: [
      ...board.categories,
      { id: 'income', name: 'Income', cardId: null },
      { id: 'fees', name: 'Bank & fees', cardId: null },
      { id: 'transport', name: 'Vehicle', cardId: null },
    ],
  };

  it('files bank interest as income and the tax on it as a bank charge', () => {
    const interest = parseSms(
      'LKR 35.81 credited to Ac No:13802XXXXX40 on 27/09/26 21:05:36 Reason:13802XXXXX40:Int.Pd:31-08-2026 to 27-09-2026 Bal:LKR 23,332.84 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
    )!;
    expect(interest.merchant).toBe('Interest');
    expect(reconcileSms(interest, withIncome, 'd').subcategoryId).toBe('interest');

    const tax = parseSms(
      'Your A/C No: ********1509 is debited with LKR11.03 on 27 SEP 2026 ref: Advance Income Tax. Your bal is LKR52,022.3. If unauthorized call 0112350035',
    )!;
    expect(tax.kind).toBe('bank_charge');
    expect(reconcileSms(tax, withIncome, 'd').subcategoryId).toBe('charges');
  });

  it('reads "ATM POS Transaction" at a fuel station as a purchase, not cash', () => {
    const fuel = parseSms(
      'Dear MR M N LAHIRU DILSHAN,LKR 11,691.00 Debited from your A/c XXXXXXXX5891 on 11/10/2026 at 12:38.AvlBal LKR 415,649.96. @ S T S RANASINGHE KADUWELA. ATM POS Transaction.Thank you for banking with us.Call Centre 1972.',
    )!;
    expect(fuel.kind).toBe('purchase');
    const draft = reconcileSms(fuel, withIncome, 'd');
    expect(draft.hint).not.toBe('atm');
    expect(draft.subcategoryId).not.toBe('cash2');
  });

  it('reads a plain "POS Transaction" as a purchase', () => {
    const shop = parseSms(
      'Dear Customer,LKR 4,250.75 Debited from your A/c XXXXXXXX4150 on 02/11/2026 at 18:12.AvlBal LKR 10,749.25. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    )!;
    expect(shop.kind).toBe('purchase');
  });

  it('keeps the whole word REFUND in a refund’s description', () => {
    const refund = parseSms(
      'Dear Customer,LKR 1,250.00 Credited to your A/c XXXXXXXX4150 on 09/11/2026 at 11:02.AvlBal LKR 3,000.00.Transaction REFUND KEELLS SUPER.Thank you for banking with us.Call Centre 1972.',
    )!;
    expect(refund.merchant).toBe('REFUND KEELLS SUPER');
  });
});
