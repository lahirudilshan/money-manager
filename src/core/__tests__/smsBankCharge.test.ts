import { describe, expect, it } from 'vitest';
import { isBankChargeLine, reconcileSms } from '../smsReconcile';
import { parseSms } from '../smsParser';
import { proposalForHint } from '../hintCatalog';
import { inferCategoryHint } from '../smsCategoryHints';

/**
 * Bank fees are DETECTED and SORTED, not hidden.
 *
 * They were briefly auto-filed straight to the board without appearing in the
 * review queue, on the reasoning that a 25-rupee charge is noise. In practice
 * that was worse than showing it: the fee vanished from Smart Detect and the
 * user went looking for a transaction the app had silently decided not to
 * mention. The behaviour now is "detected, already categorised, still visible".
 */

const CHARGE =
  'LKR 25.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Transfer Charges. Avl Bal 8,747.20 Call 94112448888 for info';

const BOARD = {
  subcategories: [
    { id: 'sub-bank', name: 'Bank charges', type: 'expense' as const, plannedMinor: 0, categoryId: 'cat-bank', cardId: null, loanId: null },
    { id: 'sub-elec', name: 'Electricity', type: 'expense' as const, plannedMinor: 500_000, categoryId: 'cat-house', cardId: null, loanId: null },
    { id: 'sub-xfer', name: 'Transfers to family', type: 'expense' as const, plannedMinor: 1_000_000, categoryId: 'cat-house', cardId: null, loanId: null },
  ],
  categories: [
    { id: 'cat-bank', name: 'Bank & fees', cardId: null },
    { id: 'cat-house', name: 'Housing', cardId: null },
  ],
  cards: [],
};

describe('the CEFTS transfer charge', () => {
  it('is detected as a bank charge, not a transfer', () => {
    // It contains the word "Transfer", so the transfer rule used to claim it.
    const parsed = parseSms(CHARGE)!;
    expect(parsed.kind).toBe('bank_charge');
    expect(parsed.amountMinor).toBe(2_500);
  });

  it('is sorted onto the Bank charges line', () => {
    const draft = reconcileSms(parseSms(CHARGE)!, BOARD, 'd1');
    expect(draft.subcategoryId).toBe('sub-bank');
  });

  it('never lands on a real transfer line despite the shared wording', () => {
    /*
     * The trap. "CEFTS Transfer Charges" fuzzy-matches any line named
     * "Transfers…", so without an explicit rule a 25-rupee fee competes with
     * the user's genuine family transfers.
     */
    const draft = reconcileSms(parseSms(CHARGE)!, BOARD, 'd1');
    expect(draft.matches.map((match) => match.subcategoryId)).toEqual(['sub-bank']);
  });

  it('stays in the review queue rather than being filed invisibly', () => {
    // A draft with a subcategory is a QUEUED row that is already categorised —
    // it has not been confirmed away.
    const draft = reconcileSms(parseSms(CHARGE)!, BOARD, 'd1');
    expect(draft.subcategoryId).not.toBe('');
    expect(draft.parsed.raw).toBe(CHARGE);
  });
});

describe('isBankChargeLine', () => {
  it('recognises the line however the user named it', () => {
    for (const name of ['Bank charges', 'Bank Charges', 'Bank fees', 'bank fee', 'Charges - Bank']) {
      expect(isBankChargeLine(name)).toBe(true);
    }
  });

  it('does not claim unrelated lines', () => {
    for (const name of ['Transfers to family', 'Electricity', 'Groceries', 'Late payment charge']) {
      expect(isBankChargeLine(name)).toBe(false);
    }
  });
});

describe('nothing is created before the user confirms', () => {
  /*
   * The rule this file exists to protect. Two earlier versions both wrote to
   * the board during the DRAIN — the first confirmed the fee outright (so it
   * vanished from Smart Detect entirely), the second created the "Bank & fees"
   * category and its line before the user had agreed to anything. An incoming
   * SMS must never add a category to someone's board unprompted.
   */
  it('proposes Bank & fees rather than matching anything on an empty board', () => {
    const empty = { subcategories: [], categories: [], cards: [] };
    const draft = reconcileSms(parseSms(CHARGE)!, empty, 'd1');

    // No match, so the confirm sheet falls through to the proposal path and
    // `createLineForDraft` builds the line only when the user taps confirm.
    expect(draft.matches).toEqual([]);
    expect(draft.subcategoryId).toBe('');
  });

  it('proposes the Bank & fees catalog entry for a fee', () => {
    const parsed = parseSms(CHARGE)!;
    const hint = inferCategoryHint(`${parsed.merchant} ${parsed.raw}`);
    const proposal = proposalForHint(hint);

    expect(hint).toBe('bank_charge');
    expect(proposal?.category.name).toBe('Bank & fees');
    expect(proposal?.subcategory.name).toBe('Bank charges');
  });

  it('does NOT tag a real transfer as a bank charge', () => {
    // "CEFTS Transfer Charges" and "CEFTS Outward Transfer" differ by one word.
    const transfer = parseSms(
      'LKR 10,000.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Outward Transfer. Avl Bal 8,747.20',
    )!;
    expect(inferCategoryHint(`${transfer.merchant} ${transfer.raw}`)).toBe('transfer');
  });

  it('does NOT tag an ATM withdrawal as a bank charge', () => {
    // The receipt itemises "Txn Fee: 30.00LKR"; the transaction is the cash.
    const atm = parseSms(
      'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  85000.00 LKR\nA/C: 1380***4150\nTxn Fee: 30.00LKR\nAvl Bal: 640099.67 LKR',
    )!;
    expect(inferCategoryHint(`${atm.merchant} ${atm.raw}`)).toBe('atm');
  });
});
