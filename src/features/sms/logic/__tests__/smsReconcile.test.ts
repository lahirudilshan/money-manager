import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';
import {
  CONFIDENT_MATCH_SCORE,
  accountLabelFor,
  reconcileSms,
  type BoardSlice,
} from '../smsReconcile';

const board: BoardSlice = {
  cards: [
    { id: 'card-hnb', nickname: null, last4: '1234', bankName: 'HNB' },
    { id: 'card-boc', nickname: null, last4: '8765', bankName: 'BOC' },
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

/**
 * Naming the account an SMS hit is what tells the user the draft is really
 * theirs, so the label must never invent a match — and never read awkwardly for
 * the common case where the user named the card after its bank.
 */
describe('accountLabelFor', () => {
  // `extractAccount` reduces the message's masked fragment to its trailing
  // digits, so these are the shapes the label actually receives.
  it('names a matched account with its digits', () => {
    // The fixture card has no nickname, so the bank and the digits are all
    // there is to say.
    expect(accountLabelFor('1234', board.cards)).toBe('HNB ••1234');
  });

  it("includes the user's nickname between the bank and the digits", () => {
    const cards = [{ id: 'c', nickname: 'Salary', last4: '4150', bankName: 'HNB' }];
    expect(accountLabelFor('4150', cards)).toBe('HNB Salary ••4150');
  });

  // A nickname that merely repeats the bank would read "HNB HNB ••4150".
  it('does not repeat the bank when the nickname echoes it, regardless of case', () => {
    const cards = [{ id: 'c', nickname: 'hnb', last4: '4150', bankName: 'HNB' }];
    expect(accountLabelFor('4150', cards)).toBe('HNB ••4150');
  });

  it('omits the bank when none is recorded', () => {
    const cards = [{ id: 'c', nickname: 'Wallet', last4: '4150', bankName: null }];
    expect(accountLabelFor('4150', cards)).toBe('Wallet ••4150');
  });

  it('falls back to the bare digits when nothing matches', () => {
    expect(accountLabelFor('9999', board.cards)).toBe('••9999');
  });

  it('matches on the trailing digits a longer fragment ends with', () => {
    // extractAccount can return more than four digits for some banks; the card
    // still matches on its last-4 and is named rather than shown as raw digits.
    expect(accountLabelFor('13801234', board.cards)).toBe('HNB ••1234');
  });

  it('is empty when the message carried no account digits', () => {
    expect(accountLabelFor('', board.cards)).toBe('');
  });
});

describe('foreign-currency conversion', () => {
  const usdSalarySms =
    'Your A/C No: ********7427 is credited with USD2,500.00 on 31 JUL 2026 ref: Inward SWIFT Payment. Your bal is USD5,002.26.';

  it('converts a USD credit into the home currency before logging', () => {
    const parsed = parseSms(usdSalarySms)!;
    const draft = reconcileSms(parsed, board, 'd1', [], { currency: 'LKR', usdRate: 300 });

    // 2,500 USD at 300 = 750,000 LKR.
    expect(draft.amountMinor).toBe(75_000_000);
    // The message's own figure is preserved for the review UI.
    expect(draft.foreign).toEqual({ currency: 'USD', amountMinor: 250_000 });
  });

  it('leaves the parsed amount untouched — only the draft is converted', () => {
    const parsed = parseSms(usdSalarySms)!;
    const draft = reconcileSms(parsed, board, 'd2', [], { currency: 'LKR', usdRate: 300 });
    expect(draft.parsed.amountMinor).toBe(250_000);
    expect(draft.parsed.currency).toBe('USD');
  });

  it('does not convert when the message is already in the home currency', () => {
    const parsed = parseSms(
      'LKR 9,500.00 debited from AC XXXXXXXX1234 as POS TXN on 24 Jul 2026 at CEYLON ELECTRICITY BOARD. Avl Bal 1.00',
    )!;
    const draft = reconcileSms(parsed, board, 'd3', [], { currency: 'LKR', usdRate: 300 });
    expect(draft.amountMinor).toBe(950_000);
    expect(draft.foreign).toBeNull();
  });

  it('scores a converted USD salary against the LKR salary plan', () => {
    // The board's salary line plans 350,000 LKR. At a rate of 140, the 2,500 USD
    // credit converts to exactly that — so the amount signal fires only because
    // the conversion happened before scoring. Without it, 2,500 minor units
    // would be compared against 350,000 and score nothing.
    const parsed = parseSms(usdSalarySms)!;
    const converted = reconcileSms(parsed, board, 'd4', [], { currency: 'LKR', usdRate: 140 });
    expect(converted.amountMinor).toBe(35_000_000);

    const salaryMatch = converted.matches.find((m) => m.subcategoryId === 'sub-salary');
    expect(salaryMatch).toBeDefined();

    // The same message with no conversion cannot reach the salary line on amount.
    const unconverted = reconcileSms(parsed, board, 'd4b', [], { currency: 'USD', usdRate: 140 });
    const unconvertedMatch = unconverted.matches.find((m) => m.subcategoryId === 'sub-salary');
    expect(salaryMatch!.score).toBeGreaterThan(unconvertedMatch?.score ?? 0);
  });

  it('passes an unconvertible currency through rather than using a wrong rate', () => {
    const parsed = parseSms(
      'Your account 1234 is credited with EUR 1,200.00 on 01 Jul 2026 ref: Payment',
    )!;
    const draft = reconcileSms(parsed, board, 'd5', [], { currency: 'LKR', usdRate: 300 });
    // No EUR→LKR rate is stored, so the figure is left for the user to correct
    // rather than silently multiplied by the USD rate.
    expect(draft.amountMinor).toBe(120_000);
    expect(draft.foreign).toBeNull();
  });

  it('ignores a zero or nonsensical stored rate', () => {
    const parsed = parseSms(usdSalarySms)!;
    const draft = reconcileSms(parsed, board, 'd6', [], { currency: 'LKR', usdRate: 0 });
    expect(draft.amountMinor).toBe(250_000);
  });
});
