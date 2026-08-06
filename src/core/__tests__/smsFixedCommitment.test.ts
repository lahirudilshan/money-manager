import { describe, expect, it } from 'vitest';
import { isFixedCommitment, reconcileSms, type BoardSlice } from '../smsReconcile';
import { parseSms } from '../smsParser';

/**
 * Matching a loan/lease repayment by its AMOUNT when the message says nothing.
 *
 * A lease or loan debit routinely arrives as bare text — "LKR 42,350.00 debited
 * from AC 6796" — with no merchant, no biller and no "loan" anywhere. Every text
 * signal the scorer has is then zero, so the draft used to land with no
 * suggestion at all, even though the board held a line planned at exactly that
 * figure.
 *
 * For a line that bills a FIXED sum every period, that exact match is strong
 * evidence: the bank is debiting precisely what the line exists to pay. For a
 * utility it is coincidence, because its planned figure is an estimate that
 * drifts month to month — which is why the bonus is restricted to fixed
 * commitments.
 */

const line = (
  id: string,
  name: string,
  plannedMinor: number,
  loanId: string | null = null,
): BoardSlice['subcategories'][number] => ({
  id,
  name,
  type: 'expense',
  plannedMinor,
  categoryId: 'c1',
  cardId: null,
  loanId,
});

const LEASE = line('l1', 'Car Lease', 4_235_000, 'loan-1');
const WATER = line('u1', 'Water Bill', 300_000);
const GROCERIES = line('g1', 'Groceries', 5_000_000);

function pick(text: string, subcategories = [LEASE, WATER, GROCERIES]): string | null {
  const parsed = parseSms(text);
  if (!parsed) return null;

  const draft = reconcileSms(
    parsed,
    { subcategories, categories: [{ id: 'c1', name: 'Bills', cardId: null }], cards: [] },
    'row-1',
  );

  return subcategories.find((s) => s.id === draft.subcategoryId)?.name ?? null;
}

describe('exact amount against a fixed commitment', () => {
  /** The case this exists for: a bare debit that only the amount identifies. */
  it('matches a bare debit to the lease line it exactly equals', () => {
    expect(pick('LKR 42,350.00 debited from AC 6796')).toBe('Car Lease');
  });

  /** Off by more than a rupee is not evidence — the bonus needs an exact hit. */
  it('does not match an amount that is merely close', () => {
    expect(pick('LKR 39,000.00 debited from AC 6796')).toBeNull();
  });

  /**
   * A utility's planned figure is an estimate, so landing on it exactly is
   * coincidence rather than proof. No bonus.
   */
  it('does not apply the bonus to a variable utility line', () => {
    expect(pick('LKR 3,000.00 debited from AC 6796')).toBeNull();
  });

  /**
   * The regression the first attempt introduced.
   *
   * The guard originally tested the per-line signals, which against the LEASE
   * line are always zero — so a message naming a supermarket still claimed the
   * lease on amount alone. The test has to ask whether the MESSAGE named
   * anything, not whether it matched this line.
   */
  it('lets a named merchant win over an equal-amount lease line', () => {
    expect(pick('LKR 42,350.00 debited at KEELLS')).toBe('Groceries');
  });

  /**
   * A loan-linked line whose NAME says nothing about being one.
   *
   * "Toyota Aqua" is a lease as far as the user is concerned, and the earlier
   * name-sniffing had no way to know that. The link to the loan record is what
   * makes the exact-amount match work, with nothing for the user to configure.
   */
  it('applies to a loan-linked line whose name says nothing about being one', () => {
    const car = line('r2', 'Toyota Aqua', 8_500_000, 'loan-2');

    expect(pick('LKR 85,000.00 debited from AC 6796', [car, WATER])).toBe('Toyota Aqua');
  });

  /**
   * The inverse: a line NAMED like a commitment but not linked to a loan gets
   * no bonus. Only the loan record counts, so a hand-named "House Rent" that
   * happens to equal a debit is still treated as coincidence.
   */
  it('ignores a commitment-sounding name with no loan link', () => {
    const rent = line('r3', 'House Rent', 8_500_000);

    expect(pick('LKR 85,000.00 debited from AC 6796', [rent, WATER])).toBeNull();
  });
});

/**
 * The repayment vocabulary.
 *
 * `kind` was set from `\bloan[-\s]` alone, so a lease rental or a bare
 * "instalment" fell through to 'other' — and the loan prior in the scorer, which
 * exists to keep a repayment off every other bill, never fired.
 */
describe('loan / lease repayment detection', () => {
  const kindOf = (text: string) => parseSms(text)?.kind ?? null;

  it('still recognises the original loan wording', () => {
    expect(kindOf('LKR 42,350.00 loan payment debited')).toBe('loan_payment');
  });

  it('recognises a lease rental', () => {
    expect(kindOf('LKR 42,350.00 debited for LEASE RENTAL')).toBe('loan_payment');
  });

  it('recognises leasing', () => {
    expect(kindOf('LKR 42,350.00 LEASING debited from AC 6796')).toBe('loan_payment');
  });

  /** Both spellings — UK doubles the L and local banks use either. */
  it('recognises instalment and installment', () => {
    expect(kindOf('LKR 42,350.00 instalment debited')).toBe('loan_payment');
    expect(kindOf('LKR 42,350.00 installment debited')).toBe('loan_payment');
  });

  it('recognises EMI', () => {
    expect(kindOf('LKR 42,350.00 EMI debited from AC 6796')).toBe('loan_payment');
  });

  /** An ordinary purchase must not be swept up by the widened pattern. */
  it('leaves an ordinary purchase alone', () => {
    expect(kindOf('LKR 1,038.30 debited at KEELLS on 02/08')).not.toBe('loan_payment');
  });
});

describe('a lease debit that names only its transaction type', () => {
  /*
   * The user's real vehicle lease deduction. It arrives as a bare
   * "as Transfer Out" — no merchant, no loan vocabulary — for exactly the
   * amount their lease line is planned at.
   *
   * Two things previously stopped it matching:
   *   1. "Transfer Out" counted as "the message named something", suppressing
   *      the exact-amount evidence. But that label is the bank's word for the
   *      mechanism; EVERY outgoing transfer carries one, so it distinguishes
   *      nothing.
   *   2. `isFixedCommitment` required a `loanId`, and the loan table is opt-in
   *      — someone who tracks a lease as an ordinary monthly bill got no
   *      benefit at all.
   */
  const LEASE_SMS =
    'LKR 122,867.00 debited from AC XXXXXXXX6796 on 01 Aug 2026 06:04 as Transfer Out. Avl Bal 5,543.06 Call 94112448888 for info';

  const BOARD = {
    subcategories: [
      { id: 'lease', name: 'Vehicle lease', type: 'expense' as const, plannedMinor: 12_286_700, categoryId: 'c1', cardId: null, loanId: null },
      { id: 'xfer', name: 'Transfers to family', type: 'expense' as const, plannedMinor: 1_000_000, categoryId: 'c2', cardId: null, loanId: null },
      { id: 'groc', name: 'Groceries', type: 'expense' as const, plannedMinor: 5_000_000, categoryId: 'c2', cardId: null, loanId: null },
    ],
    categories: [
      { id: 'c1', name: 'Loans', cardId: null },
      { id: 'c2', name: 'Living', cardId: null },
    ],
    cards: [],
  };

  it('matches the lease line on the amount alone', () => {
    const draft = reconcileSms(parseSms(LEASE_SMS)!, BOARD, 'd1');
    expect(draft.subcategoryId).toBe('lease');
  });

  it('treats a lease line as fixed even with no loan record', () => {
    // The loan table is opt-in; a named lease is contractually fixed regardless.
    expect(
      isFixedCommitment({ id: 'l', name: 'Vehicle lease', type: 'expense', plannedMinor: 1, categoryId: 'c', cardId: null, loanId: null }),
    ).toBe(true);

    expect(
      isFixedCommitment({ id: 'g', name: 'Groceries', type: 'expense', plannedMinor: 1, categoryId: 'c', cardId: null, loanId: null }),
    ).toBe(false);
  });

  it('does NOT turn every outward transfer into a lease', () => {
    /*
     * The safeguard. A genuine 10,000 payment to the user's parents uses the
     * same "CEFTS Outward Transfer" wording — it must not inherit the lease
     * line just because both are transfers.
     */
    const parents = parseSms(
      'LKR 10,000.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Outward Transfer. Avl Bal 8,747.20',
    )!;

    expect(reconcileSms(parents, BOARD, 'd2').subcategoryId).not.toBe('lease');
  });

  it('still lets a named merchant beat an equal-amount lease line', () => {
    // A real merchant name is stronger evidence than an amount coincidence,
    // even when the amount matches the lease to the cent.
    const keells = parseSms(
      'LKR 122,867.00 debited from AC XXXXXXXX6796 as POS TXN at KEELLS SUPER. Avl Bal 5,543.06',
    )!;

    expect(reconcileSms(keells, BOARD, 'd3').subcategoryId).toBe('groc');
  });
});
