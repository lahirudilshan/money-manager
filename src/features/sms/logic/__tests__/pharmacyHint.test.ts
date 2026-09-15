import { describe, expect, it } from 'vitest';
import { inferCategoryHint } from '../smsCategoryHints';

/**
 * A pharmacy run, which the detector had no vocabulary for.
 *
 * `health` existed as a tag and HINT_SELF_WORDS knew the words — but that list
 * matches BILL NAMES, not messages. HINT_KEYWORDS, which reads the message, had
 * no health entry at all, so "A S P Pharmacy & Grocery Kelaniya" matched
 * nothing and the card said "Needs a category".
 *
 * Worse, NDB's boilerplate "ATM POS Transaction" made the atm rule fire on the
 * whole raw text, so the one hint it did produce was "ATM cash" for a purchase
 * at a chemist.
 */

const PHARMACY_RAW =
  'A S P Pharmacy & Grocery Kelaniya Dear MR M N LAHIRU DILSHAN,LKR 1,124.20 Debited from your A/c XXXXXXXX5891 on 13/09/2026 at 20:50. @ A S P Pharmacy & Grocery Kelaniya. ATM POS Transaction.';

const WITHDRAWAL_RAW =
  'Hatton National Bank HNB MAINETTEC Dear MR,LKR 4,000.00 Debited. @ Hatton National Bank HNB MAINETTEC. ATM LankaPay Cash Withdrawal.';

describe('a pharmacy purchase', () => {
  it('is health, not ATM cash', () => {
    expect(inferCategoryHint(PHARMACY_RAW)).toBe('health');
  });

  it('recognises the usual chemist words', () => {
    for (const name of ['City Pharmacy', 'Union Chemists', 'Nawaloka Hospital', 'medical centre']) {
      expect(inferCategoryHint(name), name).toBe('health');
    }
  });
});

describe('a real cash withdrawal', () => {
  it('is still ATM', () => {
    // The health fix must not swallow genuine withdrawals.
    expect(inferCategoryHint(WITHDRAWAL_RAW)).toBe('atm');
  });

  it('still matches a bare ATM message', () => {
    expect(inferCategoryHint('HNB ATM Withdrawal e-Receipt')).toBe('atm');
  });
});
