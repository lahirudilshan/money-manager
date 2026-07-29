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

/**
 * The learning half: a rule the user taught us must beat the shipped keyword
 * heuristics, and must degrade safely when the line it points at is gone.
 */
describe('reconcileSms with learned merchant rules', () => {
  const rule = (pattern: string, subcategoryId: string | null, hitCount = 1) => ({
    id: `rule-${pattern}`,
    pattern,
    subcategoryId,
    hint: null,
    source: 'learned' as const,
    hitCount,
    updatedAt: 0,
  });

  const unknownMerchantSms =
    'LKR 4,500.00 debited from AC XXXXXXXX1234 as POS TXN on 20 Jul 2026 at F L I TRADING. Avl Bal 1,000.00';

  it('is unknown for a merchant with no rule and no keyword match', () => {
    const draft = reconcileSms(parseSms(unknownMerchantSms)!, board, 'd1');
    expect(draft.confidence).toBe('unknown');
    expect(draft.subcategoryId).toBe('');
  });

  it('matches an unrecognisable merchant once a rule has been learned', () => {
    const draft = reconcileSms(parseSms(unknownMerchantSms)!, board, 'd2', [
      rule('fli trading', 'sub-elec'),
    ]);
    expect(draft.confidence).toBe('exact');
    expect(draft.subcategoryId).toBe('sub-elec');
  });

  it('lets a learned rule override the keyword-based guess', () => {
    // "water" would normally pull this to sub-water via the hint keywords.
    const parsed = parseSms(
      'LKR 2,300.00 debited from AC XXXXXXXX1234 as POS TXN on 20 Jul 2026 at NATIONAL WATER SUPPLY. Avl Bal 1,000.00',
    )!;
    const keywordDraft = reconcileSms(parsed, board, 'd3');
    expect(keywordDraft.subcategoryId).toBe('sub-water');

    const learnedDraft = reconcileSms(parsed, board, 'd4', [
      rule('national water supply', 'sub-elec'),
    ]);
    expect(learnedDraft.subcategoryId).toBe('sub-elec');
  });

  it('ignores a rule whose line no longer exists, falling back to scoring', () => {
    const draft = reconcileSms(parseSms(unknownMerchantSms)!, board, 'd5', [
      rule('fli trading', 'sub-deleted'),
    ]);
    expect(draft.subcategoryId).toBe('');
    expect(draft.confidence).toBe('unknown');
  });

  it('ignores a rule pointing at the wrong direction of line', () => {
    // A debit must never resolve onto an income line, learned or not.
    const draft = reconcileSms(parseSms(unknownMerchantSms)!, board, 'd6', [
      rule('fli trading', 'sub-salary'),
    ]);
    expect(draft.subcategoryId).toBe('');
  });
});
