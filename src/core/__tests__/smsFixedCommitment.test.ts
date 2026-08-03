import { describe, expect, it } from 'vitest';
import { reconcileSms, type BoardSlice } from '../smsReconcile';
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

  /** A line named like a fixed commitment qualifies without a loan link. */
  it('applies to a hand-named rent line with no loan record', () => {
    const rent = line('r1', 'House Rent', 8_500_000);

    expect(pick('LKR 85,000.00 debited from AC 6796', [rent, WATER])).toBe('House Rent');
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
