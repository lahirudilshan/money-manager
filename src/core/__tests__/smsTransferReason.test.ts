import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';
import { reconcileSms } from '../smsReconcile';

/**
 * The reason the USER typed when they made a mobile-banking transfer.
 *
 * A transfer names no merchant — the money went to an account, not a shop — so
 * every merchant clause comes back empty and the review card said "Need a
 * category". But the message carries the user's own words:
 *
 *   "LKR 40,000.00 debited to Ac No:13802XXXXX50 ... Reason:MB:food expenses"
 *
 * The app had the answer written in plain English and threw it away. This is
 * the real message from the user's queue: a 40,000 transfer for food that
 * arrived with no category at all.
 */

const FOOD_TRANSFER =
  'LKR 40,000.00 debited to Ac No:13802XXXXX50 on 08/08/26 22:16:37 Reason:MB:food expenses Bal:LKR 300,807.43 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462';

const BOARD = {
  subcategories: [
    { id: 'sub-groc', name: 'Groceries', type: 'expense' as const, plannedMinor: 5_000_000, categoryId: 'c1', cardId: null, loanId: null },
    { id: 'sub-fuel', name: 'Fuel', type: 'expense' as const, plannedMinor: 2_000_000, categoryId: 'c1', cardId: null, loanId: null },
  ],
  categories: [{ id: 'c1', name: 'Living', cardId: null }],
  cards: [],
};

describe('the 40,000 transfer that said "food expenses"', () => {
  it('reads the typed reason as the description', () => {
    // It was ''. That empty string is why the card had nothing to show.
    expect(parseSms(FOOD_TRANSFER)!.merchant).toBe('food expenses');
  });

  it('stops before the bank boilerplate that follows it', () => {
    /*
     * The balance, the scam warning and the hotline all trail the reason. An
     * earlier merchant reader ran into exactly this and produced "Bal:LKR
     * 405,757" as a payee name.
     */
    const merchant = parseSms(FOOD_TRANSFER)!.merchant;
    expect(merchant).not.toMatch(/Bal|Protect|Hotline|scams/i);
  });

  it('gets a real category instead of "Need a category"', () => {
    expect(reconcileSms(parseSms(FOOD_TRANSFER)!, BOARD, 'd1').hint).toBe('groceries');
  });

  it('lands on the Groceries line', () => {
    expect(reconcileSms(parseSms(FOOD_TRANSFER)!, BOARD, 'd1').subcategoryId).toBe('sub-groc');
  });

  it('is still a transfer, so it can pair with its other half', () => {
    /*
     * The regression this guards. `classifyKind` marks an MB debit with no
     * payee as `transfer_out`, and that rule tested "did we recover a
     * merchant". Reading the reason gives it one — so a naive change silently
     * reclassifies every annotated transfer, and a top-up that can no longer
     * pair counts as BOTH spend and income.
     */
    expect(parseSms(FOOD_TRANSFER)!.kind).toBe('transfer_out');
  });

  it('reads other things the user might type', () => {
    const fuel = 'LKR 2,000.00 debited to Ac No:13802XXXXX50 on 08/08/26 Reason:MB:fuel for car Bal:LKR 300.00';
    expect(parseSms(fuel)!.merchant).toBe('fuel for car');
    expect(reconcileSms(parseSms(fuel)!, BOARD, 'd2').hint).toBe('fuel');
  });
});

describe('transfers with no reason given', () => {
  it('treats HNB\'s bare "ref" marker as no reason at all', () => {
    /*
     * "Reason:MB:ref" is an empty placeholder, not a description. It must stay
     * empty: `classifyKind` relies on the absence of a payee to recognise the
     * transfer, and "ref" as a merchant name teaches the learning table
     * nonsense.
     */
    const bare = 'LKR 10,000.00 debited to Ac No:13802XXXXX50 on 08/08/26 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams';
    const parsed = parseSms(bare)!;
    expect(parsed.merchant).toBe('');
    expect(parsed.kind).toBe('transfer_out');
  });

  it('ignores a reason that is only a reference number', () => {
    const numeric = 'LKR 5,000.00 debited to Ac No:13802XXXXX50 on 08/08/26 Reason:MB:0071 Bal:LKR 300.00';
    expect(parseSms(numeric)!.merchant).toBe('');
  });

  it('still surfaces a loan code, which outranks a plain reason', () => {
    const loan = 'LKR 42,350.00 debited to Ac No:13802XXXXX50 on 08/08/26 Reason:MB:loan-AML08 Bal:LKR 300.00';
    const parsed = parseSms(loan)!;
    expect(parsed.merchant).toBe('loan-AML08');
    expect(parsed.kind).toBe('loan_payment');
  });
});

/**
 * The last-resort suggestion.
 *
 * When every confident reading comes back empty, showing the weak one beats
 * showing nothing: both cost a tap when wrong, and only one of them can be
 * right. What it must NOT do is choose the budget line — a word found loose in
 * the message body is not enough to decide where money comes from.
 */
describe('a weak category word found only in the message body', () => {
  const WEAK = {
    direction: 'debit' as const,
    kind: 'purchase' as const,
    amountMinor: 150_000,
    currency: 'LKR',
    merchant: 'ZZQQ TRADING',
    raw: 'LKR 1,500.00 debited at ZZQQ TRADING. food. Avl Bal 1,000.00',
    account: '6796',
    date: '2026-08-10',
    time: null,
  };

  it('is offered as a suggestion rather than "Need a category"', () => {
    expect(reconcileSms(WEAK, BOARD, 'd3').hint).toBe('groceries');
  });

  it('does NOT auto-select a budget line on that evidence alone', () => {
    /*
     * The guard that makes the fallback safe. A 0.2 body match labels the row,
     * but the user still chooses where it lands — otherwise a stray word
     * silently files money against a line they never picked.
     */
    const draft = reconcileSms(WEAK, BOARD, 'd3');
    expect(draft.subcategoryId).toBe('');
    expect(draft.confidence).toBe('unknown');
  });

  it('says nothing when the message contains no category word at all', () => {
    const nothing = { ...WEAK, merchant: 'ZZQQ TRADING', raw: 'LKR 1,500.00 debited at ZZQQ TRADING. Avl Bal 1,000.00' };
    expect(reconcileSms(nothing, BOARD, 'd4').hint).toBeNull();
  });
});

/**
 * The bank's channel heading is not a category.
 *
 * "HNB SMS ALERT:INTERNET" means the card was used online — it says nothing
 * about what was bought. But "internet" is also telecom vocabulary, and the
 * keyword walk returns the first tag it finds anywhere in the message, so every
 * card-not-present purchase was filed as a phone bill.
 */
describe('the INTERNET channel heading', () => {
  const board = {
    subcategories: [
      { id: 'sub-tel', name: 'Mobile / phone bill', type: 'expense' as const, plannedMinor: 500_000, categoryId: 'c1', cardId: null, loanId: null },
      { id: 'sub-tra', name: 'Transport', type: 'expense' as const, plannedMinor: 1_000_000, categoryId: 'c1', cardId: null, loanId: null },
      { id: 'sub-din', name: 'Eating out & delivery', type: 'expense' as const, plannedMinor: 1_500_000, categoryId: 'c1', cardId: null, loanId: null },
    ],
    categories: [{ id: 'c1', name: 'Living', cardId: null }],
    cards: [],
  };

  it('does not make an online purchase a phone bill', () => {
    const uber =
      'HNB SMS ALERT:INTERNET, Account:1380***6626,Location:UBER EATS, LK,Amount(Approx.):3497.91 LKR,Av.Bal:21427.48 LKR,Date:16.08.26,Time:01:29';
    const draft = reconcileSms(parseSms(uber)!, board, 'd5');
    /*
     * `dining`, not telecom — and not `transport` either.
     *
     * This asserted transport when the heading fix landed, because "UBER" was
     * the only brand the scorer knew. UBER EATS is a food order that happens to
     * be sold by a taxi company, so the delivery reading is the right one; see
     * the eating-out split in merchantSignals.
     */
    expect(draft.hint).toBe('dining');
    expect(draft.subcategoryId).toBe('sub-din');
  });

  it('still recognises a genuine telecom merchant', () => {
    /*
     * The other half of the guard: stripping the heading must not cost a real
     * phone bill its category.
     */
    const dialog =
      'LKR 999.00 debited from AC XXXXXXXX6796 as POS TXN on 10 Aug 2026 at Dialog Axiata PLC Colombo 02. Avl Bal 5,000.00';
    expect(reconcileSms(parseSms(dialog)!, board, 'd6').hint).toBe('telecom');
  });
});
