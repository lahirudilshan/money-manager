import { describe, expect, it } from 'vitest';
import { parseSms } from '~/features/sms/logic/smsParser';
import { reconcileSms } from '~/features/sms/logic/smsReconcile';

/**
 * A message that names a fee is not necessarily a fee.
 *
 * BANK_CHARGE_PATTERNS fire on fee vocabulary anywhere in the text, which is
 * correct when the message IS the fee and wrong when it reports a transaction
 * and mentions the fee in passing. The second case put the TRANSACTION's amount
 * on the Bank charges line, which is how 4,000 / 9,000 / 10,000 "bank charges"
 * reached the board — amounts no real charge ever reaches.
 */
describe('a transaction that mentions its fee is not a bank charge', () => {
  it('keeps a transfer that names its charge a transfer', () => {
    const parsed = parseSms(
      'LKR 10,000.00 transferred to A/C 123. Transfer charge LKR 50.00 debited.',
    );
    expect(parsed?.kind).not.toBe('bank_charge');
    expect(parsed?.amountMinor).toBe(1_000_000);
  });

  it('does not label a five-figure debit a charge because it says "Charges"', () => {
    const parsed = parseSms(
      'Your A/C 1380***4150 debited LKR 9,000.00 for CEFTS Transfer Charges on 06.08.26. Avl Bal LKR 12,345.00',
    );
    expect(parsed?.kind).not.toBe('bank_charge');
    expect(parsed?.amountMinor).toBe(900_000);
  });

  it('still recognises a message that really is just a fee', () => {
    const parsed = parseSms(
      'Your A/C 4150 debited LKR 25.00 as CEFTS Transfer Charges. Bal LKR 1,000.00',
    );
    expect(parsed?.kind).toBe('bank_charge');
    expect(parsed?.amountMinor).toBe(2_500);
  });

  it('still recognises stamp duty', () => {
    const parsed = parseSms('Stamp duty LKR 50.00 debited from A/C 4150.');
    expect(parsed?.kind).toBe('bank_charge');
    expect(parsed?.amountMinor).toBe(5_000);
  });

  it('leaves an ATM withdrawal that itemises its fee as a withdrawal', () => {
    const parsed = parseSms(
      'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  10000.00 LKR\nTxn Fee: 30.00LKR\nAvl Bal: 347326.43 LKR',
    );
    expect(parsed?.kind).toBe('atm');
    expect(parsed?.amountMinor).toBe(1_000_000);
  });
});

/**
 * What the user typed is the best description the message carries, and a fee
 * clause sitting next to it must not be mistaken for it.
 */
describe('the typed reason survives a fee clause', () => {
  it('keeps the user\'s reason as the description', () => {
    const parsed = parseSms(
      'LKR 9,000.00 debited to Ac No:13802XXXXX50 Reason:MB:food expenses. Transfer Charges LKR 50.00. Bal LKR 1,000.00',
    );
    expect(parsed?.merchant).toBe('food expenses');
    expect(parsed?.kind).not.toBe('bank_charge');
  });

  it('keeps a reason followed by "Charges applied"', () => {
    const parsed = parseSms(
      'LKR 10,000.00 debited to Ac No:1380 Reason:MB:rent payment. Charges applied. Bal LKR 500.00',
    );
    expect(parsed?.merchant).toBe('rent payment');
  });

  /**
   * "ref" is HNB's empty marker. The fee clause after it is the bank's wording,
   * not a payee — it reached the board as a merchant literally named
   * "Transfer charge LKR 25". Emptiness here is required: internal-transfer
   * detection keys off a transfer naming no payee.
   */
  it('does not turn the fee clause into a merchant when no reason was given', () => {
    const parsed = parseSms(
      'LKR 4,000.00 debited to Ac No:1380 Reason:MB:ref. Transfer charge LKR 25.00. Bal LKR 900.00',
    );
    expect(parsed?.merchant).toBe('');
    expect(parsed?.kind).not.toBe('bank_charge');
  });
});

/**
 * The parser is only half the path.
 *
 * `inferCategoryHint` is a keyword walk with no access to the amount, so it
 * reads any fee wording as `bank_charge` — including on messages classifyKind
 * has already ruled a transaction. Fixing only the parser left the hint
 * overriding it, and the draft still proposed the Bank charges line: the tests
 * above passed while the app was still wrong. These assert the DRAFT, which is
 * what actually reaches the board.
 */
describe('the draft does not propose bank charges for a transaction', () => {
  const board = {
    subcategories: [
      { id: 'bc', name: 'Bank charges', categoryId: 'g1', type: 'expense', plannedMinor: 0 },
      { id: 'tf', name: 'Transfers', categoryId: 'g1', type: 'expense', plannedMinor: 0 },
    ],
    categories: [{ id: 'g1', name: 'Bank & fees' }],
    cards: [],
  } as never;

  it.each([
    ['a transfer that names its charge', 'LKR 10,000.00 transferred to A/C 123. Transfer charge LKR 50.00 debited.'],
    ['a five-figure CEFTS debit', 'Your A/C 1380***4150 debited LKR 9,000.00 for CEFTS Transfer Charges on 06.08.26. Avl Bal LKR 12,345.00'],
  ])('%s does not target the Bank charges line', (_label, raw) => {
    const parsed = parseSms(raw)!;
    const draft = reconcileSms(parsed, board, 'id');
    expect(draft.hint).not.toBe('bank_charge');
    expect(draft.subcategoryId).not.toBe('bc');
  });

  it('still targets Bank charges for a genuine fee', () => {
    const parsed = parseSms('Your A/C 4150 debited LKR 25.00 as CEFTS Transfer Charges. Bal LKR 1,000.00')!;
    const draft = reconcileSms(parsed, board, 'id');
    expect(draft.hint).toBe('bank_charge');
    expect(draft.subcategoryId).toBe('bc');
  });
});
