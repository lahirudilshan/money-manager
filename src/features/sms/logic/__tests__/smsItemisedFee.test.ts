import { describe, expect, it } from 'vitest';
import { extractItemisedFee, parseSms, splitItemisedFee } from '../smsParser';
import { fingerprintMessage, splitMergedMessages } from '../smsInbox';
import { orderDraftsWithFees, reconcileSms } from '../smsReconcile';
import { guessCategories } from '../merchantSignals';
import { proposalForHint } from '../hintCatalog';

/**
 * An ATM receipt states TWO movements, and only one used to survive.
 *
 *   Amt(Approx.): 85000.00 LKR   <- the withdrawal
 *   Txn Fee: 30.00LKR            <- the bank's charge
 *
 * `extractAmount` deliberately skips the fee clause so the receipt reports
 * 85,000 rather than 30 — correct, but it meant the 30 was read, recognised as
 * not-the-transaction, and thrown away. The account fell by 85,030 while the
 * board recorded 85,000, and nothing on screen explained the gap.
 */
const ATM =
  'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  85000.00 LKR\nA/C: 1380***4150\nTxn Fee: 30.00LKR\nLocation: NSB MAKOLA ATM LK     , LKA\nAvl Bal: 640099.67 LKR\nHotline:94112462462';

const BOARD = {
  subcategories: [
    { id: 'sub-bank', name: 'Bank charges', type: 'expense' as const, plannedMinor: 0, categoryId: 'cat-bank', cardId: null, loanId: null },
    { id: 'sub-cash', name: 'Cash', type: 'expense' as const, plannedMinor: 5_000_000, categoryId: 'cat-day', cardId: null, loanId: null },
  ],
  categories: [
    { id: 'cat-bank', name: 'Bank & fees', cardId: null },
    { id: 'cat-day', name: 'Day to day', cardId: null },
  ],
  cards: [],
};

describe('the fee itemised inside an ATM receipt', () => {
  it('is read as its own amount', () => {
    expect(extractItemisedFee(ATM)).toEqual({
      amountMinor: 3_000,
      currency: 'LKR',
      label: 'Txn Fee',
    });
  });

  it('leaves the withdrawal itself untouched', () => {
    // The whole point of `extractAmount` skipping the fee clause.
    const parsed = parseSms(ATM)!;
    expect(parsed.amountMinor).toBe(8_500_000);
    expect(parsed.kind).toBe('atm');
  });

  it('becomes a second draft, categorised as a bank charge', () => {
    const fee = splitItemisedFee(parseSms(ATM)!)!;

    expect(fee.amountMinor).toBe(3_000);
    expect(fee.kind).toBe('bank_charge');
    expect(fee.direction).toBe('debit');
  });

  it('keeps the parent account and date, so it files against the same card', () => {
    const parsed = parseSms(ATM)!;
    const fee = splitItemisedFee(parsed)!;

    expect(fee.account).toBe(parsed.account);
    expect(fee.date).toBe(parsed.date);
  });

  it('is sorted onto the Bank charges line', () => {
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    expect(reconcileSms(fee, BOARD, 'd-fee').subcategoryId).toBe('sub-bank');
  });

  it('does not fingerprint as its parent', () => {
    /*
     * The queue de-duplicates on a hash of `raw`. A fee row carrying the
     * receipt's text verbatim would hash identically to the withdrawal and be
     * rejected as a duplicate of it — the fee silently dropped.
     */
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    expect(fingerprintMessage(fee.raw)).not.toBe(fingerprintMessage(ATM));
  });
});

/**
 * The real message off the user's phone, unedited.
 *
 * Its `Location:` field is the ATM OPERATOR's code — "ICBS", "DFCC bank" — and
 * `extractMerchant` matched that rule before anything else, so three real
 * withdrawals reached the review queue titled "ICBS , LKA" and "DFCC bank ,
 * LKA". The user has never heard of ICBS; the message's own first line said
 * "HNB ATM Withdrawal e-Receipt" the whole time.
 */
const ICBS =
  'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  10000.00 LKR\nA/C: 1380***4150\nTxn Fee: 30.00LKR\nLocation: ICBS                  , LKA\nTerm ID: AECMKL1 \nDate: 06.08.26 Time:12:24\nTxn No: 3230290980\nAvl Bal: 347326.43 LKR\nHotline:94112462462';

describe('an ATM receipt is titled by what happened, not by where the machine was', () => {
  it('reads "HNB ATM Withdrawal", not the operator code', () => {
    const parsed = parseSms(ICBS)!;

    expect(parsed.merchant).toBe('HNB ATM Withdrawal');
    // The location is dropped rather than trailed after the name: the row is
    // competing for width with the amount, and "ICBS, LKA" earns none of it.
    expect(parsed.detail).toBeUndefined();
  });

  it('still reads the withdrawal amount, not the fee', () => {
    expect(parseSms(ICBS)!.amountMinor).toBe(1_000_000);
  });

  it('still files as ATM cash despite no longer naming a bank', () => {
    // "DFCC bank" as a merchant was the machine's owner, never a purchase.
    const parsed = parseSms(ICBS)!;
    expect(reconcileSms(parsed, BOARD, 'd-icbs').hint).toBe('atm');
  });

  it('leaves a POS purchase Location as its merchant', () => {
    /*
     * The regression this guards, caught by running the user's real queue
     * through the parser.
     *
     * HNB's POS alert ALSO opens with a transaction word — "HNB SMS ALERT:
     * PURCHASE" — so "names a transaction type" alone cannot tell a heading
     * from a report. Without the standalone-line rule, every KEELLS and SPAR
     * purchase was retitled with the bank's letterhead and lost its payee.
     *
     * This is the user's message verbatim: one comma-separated line carrying
     * the whole transaction, which is exactly what makes it not a heading.
     */
    const pos = parseSms(
      'HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:SPAR - -KELANIYA         , LK,Amount(Approx.):3075.00 LKR,Av.Bal:392657.29 LKR,Date:04.08.26,Time:22:37, Hot Line:0112462462',
    )!;

    expect(pos.merchant).toContain('SPAR');
    expect(pos.merchant).not.toContain('SMS ALERT');
  });
});

describe('a merchant that says what it is gets a category', () => {
  /*
   * The user's real queue, and the gap it exposed.
   *
   * `merchantSignals` scored NAWALOKA at health 1.00 and "A S P Pharmacy &
   * Grocery" at 0.91 — both correct. But the review card renders `hint`, which
   * came from `inferCategoryHint`, a fixed keyword list with no health, dining
   * or clothing vocabulary in it at all. So four rows whose merchant names say
   * exactly what they are showed "Needs a category", while the app privately
   * held the answer.
   */
  const hintFor = (merchant: string) =>
    reconcileSms(
      parseSms(
        `HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:${merchant}, LK,Amount(Approx.):3075.00 LKR,Av.Bal:392657.29 LKR,Date:04.08.26,Time:22:37`,
      )!,
      BOARD,
      'd',
    ).hint;

  it('reads a hospital as health', () => {
    expect(hintFor('NAWALOKA HOSPITALS LTD')).toBe('health');
    expect(hintFor('NEW NAWALOKA MEDICAL CENT')).toBe('health');
  });

  it('reads a pharmacy as health', () => {
    expect(hintFor('A S P Pharmacy & Grocery')).toBe('health');
  });

  it('reads a lab as health', () => {
    expect(hintFor('ASIRI LABORATORIES')).toBe('health');
  });

  it('still prefers the keyword list where it has an answer', () => {
    // The fallback only fills blanks — it must not override a settled mapping.
    expect(hintFor('KEELLS SUPER - SINHARAMUL')).toBe('groceries');
  });

  it('leaves a genuinely unrecognisable merchant with no hint', () => {
    // Inventing a category for a name that says nothing is worse than asking.
    expect(hintFor('XQZ 4471')).toBeNull();
  });

  /*
   * A losing category must not win the MATCH.
   *
   * Reading the merchant correctly is only half the job — the draft still has
   * to pick a line. `scoreSubcategory` walked the ranked guesses and took the
   * first one whose category matched a line name, so on a board with a
   * Groceries line and no health line, "A S P Pharmacy & Grocery" read health
   * 0.91 and then filed itself under Groceries on the strength of its own
   * runner-up. The app concluded one thing and did another.
   */
  const GROCERY_BOARD = {
    subcategories: [
      { id: 'sub-groc', name: 'Groceries', type: 'expense' as const, plannedMinor: 5_000_000, categoryId: 'cat-living', cardId: null, loanId: null },
    ],
    categories: [{ id: 'cat-living', name: 'Living', cardId: null }],
    cards: [],
  };

  const draftFor = (merchant: string) =>
    reconcileSms(
      parseSms(
        `HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:${merchant}, LK,Amount(Approx.):4397.00 LKR,Av.Bal:357356.43 LKR,Date:05.08.26,Time:21:52`,
      )!,
      GROCERY_BOARD,
      'd',
    );

  it('does not file a pharmacy under Groceries just because that line exists', () => {
    const draft = draftFor('A S P Pharmacy & Grocery');

    expect(draft.hint).toBe('health');
    // Asked, not silently mis-filed — the board has no health line to offer.
    expect(draft.subcategoryId).toBe('');
  });

  it('still files a real grocer to the Groceries line', () => {
    // The discount must not break the case it shares a code path with.
    const draft = draftFor('KEELLS SUPER - SINHARAMUL');

    expect(draft.hint).toBe('groceries');
    expect(draft.subcategoryId).toBe('sub-groc');
  });

  it('offers to create Health → Medicine when the user confirms', () => {
    // The hint is only useful if it leads somewhere; this is where it lands.
    const proposal = proposalForHint('health');

    expect(proposal?.category.name).toBe('Health');
    expect(proposal?.subcategory.name).toBe('Medicine');
  });
});

describe('both rows are named in words the user recognises', () => {
  /*
   * The bank's own vocabulary is useless on the review screen. An ATM receipt
   * names no payee, so every merchant rule came up empty and the withdrawal
   * reached the user as an amount with no label at all; the fee then read as
   * "Txn Fee", which says nothing about what it belonged to. The receipt's own
   * first line — "HNB ATM Withdrawal e-Receipt" — is what a person reads to
   * know what the message is.
   */
  it('labels the withdrawal from the receipt title', () => {
    expect(parseSms(ATM)!.merchant).toBe('HNB ATM Withdrawal');
  });

  it('names the fee after the transaction it came from', () => {
    /*
     * The SAME merchant as its parent, with the qualifier in `detail`, so the
     * card reads "HNB ATM Withdrawal — Txn Fee".
     *
     * The split is not only cosmetic: `merchant` is what learned rules key on
     * and what the categoriser scores, so folding "fee" into it would make the
     * charge a different merchant from its own withdrawal and teach the
     * learning table a name no future message will ever repeat.
     */
    const fee = splitItemisedFee(parseSms(ATM)!)!;

    expect(fee.merchant).toBe('HNB ATM Withdrawal');
    expect(fee.detail).toBe('fee');
  });

  it('keeps both the name and the detail after a reload', () => {
    // Re-parsing must not drop the qualifier, or the two rows become identical.
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    const reparsed = parseSms(fee.raw)!;

    expect(reparsed.merchant).toBe(fee.merchant);
    expect(reparsed.detail).toBe(fee.detail);
  });

  it('leaves an ordinary message with no detail to show', () => {
    expect(parseSms('LKR 500.00 spent at SPAR on 04 Aug 2026. Avl Bal 8,747.20')!.detail).toBeUndefined();
  });

  it('still files as a bank charge despite being named after an ATM', () => {
    /*
     * The regression the friendlier name introduced: "ATM Withdrawal" in the
     * merchant field scored `atm` 0.91 over `bank_charge` 0.70, so the fee was
     * about to be suggested as cash on the strength of a label chosen to
     * describe its parent.
     */
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    const [best] = guessCategories({ merchant: fee.merchant, raw: fee.raw, kind: fee.kind });

    expect(best.category).toBe('bank_charge');
  });

  it('reads "Bank charge" on the card, not "ATM cash"', () => {
    /*
     * The bug the simulator caught that the unit tests did not.
     *
     * `guessCategories` correctly returned `bank_charge`, but the review card
     * renders `draft.hint`, which came from `inferCategoryHint` — a first-match
     * keyword walk testing `atm` before `bank_charge`. The fee's text is full of
     * the word "ATM", so a LKR 30.00 row read "Looks like ATM cash" directly
     * beneath the LKR 85,000 withdrawal it was charged for.
     */
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    expect(reconcileSms(fee, BOARD, 'd-fee').hint).toBe('bank_charge');
  });

  it('leaves the withdrawal reading as ATM cash', () => {
    // The promotion applies only to charges; the parent is genuinely cash.
    expect(reconcileSms(parseSms(ATM)!, BOARD, 'd-atm').hint).toBe('atm');
  });

  it('never overwrites a real merchant name with the receipt title', () => {
    // The title is a LAST resort — "KEELLS SUPER" must always win.
    const keells = parseSms('LKR 3,500.00 spent at KEELLS SUPER on 05 Aug 2026. Avl Bal 8,747.20')!;
    expect(keells.merchant).toContain('KEELLS SUPER');
  });
});

describe('the fee row survives a round trip through the queue', () => {
  /*
   * `loadSmsDrafts` re-parses every pending row from `raw` rather than trusting
   * the stored columns. Without a marker the fee row re-reads as its PARENT —
   * the 30-rupee charge redisplayed as a second 85,000 withdrawal, doubling the
   * exact transaction this split exists to keep accurate.
   */
  it('re-parses as the fee, not as the withdrawal', () => {
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    const reparsed = parseSms(fee.raw)!;

    expect(reparsed.amountMinor).toBe(3_000);
    expect(reparsed.kind).toBe('bank_charge');
  });

  it('is never split a second time', () => {
    // Otherwise every reload would spawn another fee row from the last one.
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    expect(splitItemisedFee(parseSms(fee.raw)!)).toBeNull();
  });

  it('is not shredded by the merged-message splitter', () => {
    // The marker adds a newline, and `splitMergedMessages` splits on message
    // boundaries — it must not read the fee line as a second message.
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    expect(splitMergedMessages(fee.raw)).toHaveLength(1);
  });
});

describe('the fee is shown BENEATH the transaction it paid for', () => {
  /*
   * The queue sorts newest-first: date, then time, then arrival. A fee carries
   * its PARENT's date and time — both figures come from the same message — so
   * the first two keys tie and arrival order decides. The fee is inserted
   * second and sorts DESC, which put LKR 30.00 above the LKR 85,000.00
   * withdrawal that explains it: a charge appearing before its own cause.
   */
  const draftFor = (raw: string) => ({ parsed: { raw } });

  it('moves a fee below its parent', () => {
    const parent = parseSms(ATM)!;
    const fee = splitItemisedFee(parent)!;

    // Queue order: fee first, exactly as `pending()` returns it.
    const ordered = orderDraftsWithFees([draftFor(fee.raw), draftFor(parent.raw)]);

    expect(ordered.map((d) => d.parsed.raw)).toEqual([parent.raw, fee.raw]);
  });

  it('attaches each fee to its OWN receipt when two are queued', () => {
    /*
     * The reason a fee carries its parent's full text rather than a flag:
     * "the nearest ATM row" would pair the wrong two once a second receipt
     * arrives.
     */
    const second = ATM.replace('85000.00', '20000.00').replace('30.00LKR', '50.00LKR');

    const p1 = parseSms(ATM)!;
    const f1 = splitItemisedFee(p1)!;
    const p2 = parseSms(second)!;
    const f2 = splitItemisedFee(p2)!;

    const ordered = orderDraftsWithFees([
      draftFor(f2.raw),
      draftFor(f1.raw),
      draftFor(p2.raw),
      draftFor(p1.raw),
    ]);

    // Each parent is immediately followed by its own fee.
    const raws = ordered.map((d) => d.parsed.raw);
    expect(raws.indexOf(f2.raw)).toBe(raws.indexOf(p2.raw) + 1);
    expect(raws.indexOf(f1.raw)).toBe(raws.indexOf(p1.raw) + 1);
  });

  it('keeps a fee visible when its parent was dismissed', () => {
    /*
     * The user can dismiss the withdrawal and keep the fee. Dropping the
     * orphan would make money silently vanish — the failure this whole feature
     * exists to prevent.
     */
    const fee = splitItemisedFee(parseSms(ATM)!)!;
    const other = parseSms('LKR 500.00 spent at SPAR on 04 Aug 2026. Avl Bal 8,747.20')!;

    const ordered = orderDraftsWithFees([draftFor(other.raw), draftFor(fee.raw)]);

    expect(ordered).toHaveLength(2);
    expect(ordered.map((d) => d.parsed.raw)).toContain(fee.raw);
  });

  it('leaves a queue with no fees completely unchanged', () => {
    const rows = [draftFor('one'), draftFor('two'), draftFor('three')];
    expect(orderDraftsWithFees(rows).map((d) => d.parsed.raw)).toEqual(['one', 'two', 'three']);
  });
});

describe('what is NOT split', () => {
  it('a message that IS a fee', () => {
    /*
     * "CEFTS Transfer Charges" matches its own fee vocabulary. Splitting it
     * would spawn a second draft for the same 25 rupees — counted twice.
     */
    const charge = parseSms(
      'LKR 25.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Transfer Charges. Avl Bal 8,747.20',
    )!;

    expect(charge.kind).toBe('bank_charge');
    expect(splitItemisedFee(charge)).toBeNull();
  });

  it('an ordinary purchase that itemises nothing', () => {
    const purchase = parseSms('LKR 500.00 spent at SPAR on 04 Aug 2026. Avl Bal 8,747.20')!;
    expect(splitItemisedFee(purchase)).toBeNull();
  });

  it('a zero fee', () => {
    // Banks print "Txn Fee: 0.00" on transactions they did not charge for;
    // queueing a zero-rupee draft to confirm is pure noise.
    expect(extractItemisedFee('Amt: 100.00 LKR\nTxn Fee: 0.00LKR')).toBeNull();
  });

  it('a "fee" as large as the transaction, which can only be a misread', () => {
    /*
     * The guard against a loose label match capturing the main amount, which
     * would double the spend rather than itemise it.
     */
    const parsed = parseSms(ATM)!;
    expect(splitItemisedFee({ ...parsed, amountMinor: 3_000 })).toBeNull();
  });

  it('a credit, however it words itself', () => {
    // A credit mentioning a fee is a charge being refunded — the reversal
    // path's business, not this one.
    const credit = parseSms(
      'LKR 30.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 as Txn Fee reversal. Avl Bal 8,747.20',
    );
    if (credit) expect(splitItemisedFee(credit)).toBeNull();
  });
});
