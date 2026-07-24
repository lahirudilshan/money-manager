import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';
import { CONFIDENT_MATCH_SCORE, reconcileSms, type BoardSlice } from '../smsReconcile';

const board: BoardSlice = {
  cards: [
    { id: 'card-hnb', name: 'HNB', last4: '1234', bankName: 'HNB' },
    { id: 'card-boc', name: 'BOC', last4: '8765', bankName: 'BOC' },
  ],
  categories: [
    { id: 'cat-utils', name: 'Utilities', cardId: 'card-hnb' },
    { id: 'cat-income', name: 'Income', cardId: 'card-boc' },
  ],
  subcategories: [
    {
      id: 'sub-elec',
      name: 'Electricity',
      type: 'expense',
      plannedMinor: 850_000,
      categoryId: 'cat-utils',
      cardId: null,
      loanId: null,
    },
    {
      id: 'sub-water',
      name: 'Water',
      type: 'expense',
      plannedMinor: 230_000,
      categoryId: 'cat-utils',
      cardId: null,
      loanId: null,
    },
    {
      id: 'sub-salary',
      name: 'Salary',
      type: 'income',
      plannedMinor: 35_000_000,
      categoryId: 'cat-income',
      cardId: null,
      loanId: null,
    },
    {
      id: 'sub-loan',
      name: 'Personal loan installment',
      type: 'expense',
      plannedMinor: 18_000_000,
      categoryId: 'cat-utils',
      cardId: null,
      loanId: 'loan-1',
    },
  ],
};

describe('reconcileSms', () => {
  it('confidently matches an electricity bill to the Electricity line', () => {
    const parsed = parseSms(
      'CEB: Your electricity bill for Acct 0012345678 is Rs.8,450.00 due on 05/08/2026.',
    )!;
    const draft = reconcileSms(parsed, board, 'd1');

    expect(draft.subcategoryId).toBe('sub-elec');
    expect(draft.amountMinor).toBe(845_000);
    expect(draft.matches[0].score).toBeGreaterThanOrEqual(CONFIDENT_MATCH_SCORE);
  });

  it('routes a credit only to income lines, never to an expense', () => {
    const parsed = parseSms(
      'Your account XXXX9012 has been credited with LKR 350,000.00 (SALARY JUL) on 25/07/2026.',
    )!;
    const draft = reconcileSms(parsed, board, 'd2');

    expect(draft.subcategoryId).toBe('sub-salary');
    // Every candidate offered is an income line — no expense leaks in.
    const offered = new Set(draft.matches.map((m) => m.subcategoryId));
    expect(offered.has('sub-elec')).toBe(false);
    expect(offered.has('sub-water')).toBe(false);
  });

  it('leaves subcategoryId empty when nothing matches confidently', () => {
    const parsed = parseSms(
      'Your Card ending 1234 was debited LKR 12,500.00 at RANDOM PLACE XYZ on 24/07/2026.',
    )!;
    const draft = reconcileSms(parsed, board, 'd3');

    expect(draft.subcategoryId).toBe('');
  });

  it('routes a loan-payment SMS to the loan-linked line', () => {
    const parsed = parseSms(
      'LKR 180,025.00 debited to Ac No:13802XXXXX50 on 24/07/26 Reason:MB:loan-AML08 DO NOT SHARE /OTP',
    )!;
    // Amount is close to the installment (18,002,500 vs 18,000,000).
    const draft = reconcileSms(parsed, board, 'd5');

    expect(parsed.kind).toBe('loan_payment');
    expect(draft.subcategoryId).toBe('sub-loan');
  });

  it('still carries the parsed amount even with no match, for manual assignment', () => {
    const parsed = parseSms(
      'LKR 99,000.00 debited from AC XXXXXXXX0000 as POS TXN on 20 Jul 2026 at UNKNOWN VENDOR ZZZ. Avl Bal 1,000.00',
    )!;
    const draft = reconcileSms(parsed, board, 'd4');

    expect(draft.subcategoryId).toBe('');
    expect(draft.amountMinor).toBe(9_900_000);
  });
});
