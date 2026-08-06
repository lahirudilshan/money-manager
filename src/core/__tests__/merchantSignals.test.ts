import { describe, expect, it } from 'vitest';
import { bestCategory, guessCategories, lineMatchesCategory } from '../merchantSignals';

/**
 * Every merchant here came off the user's real review queue, where 9 of 14
 * drafts matched no category at all. Each name says plainly what it is to a
 * human — "NAWALOKA HOSPITALS", "A S P Pharmacy & Grocery", "SPAR" — and the
 * old first-match keyword walk saw none of them.
 */
describe('real merchants from the queue', () => {
  const CASES: [merchant: string, expected: string][] = [
    ['NAWALOKA HOSPITALS LTD, LK', 'health'],
    ['NEW NAWALOKA HOSPITALS PV, LK', 'health'],
    ['NEW NAWALOKA MEDICAL CENT, LK', 'health'],
    ['A S P Pharmacy & Grocery, LK', 'health'],
    ['SPAR - -KELANIYA , LK', 'groceries'],
    ['BEN FOODS , LK', 'groceries'],
    ['KEELLS SUPER - SINHARAMUL, LK', 'groceries'],
    ['CEYLON ELECTRICITY BOARD 1987', 'electricity'],
    ['National Water Supply Rathmalana', 'water'],
    ['Dialog Axiata PLC Colombo 02', 'telecom'],
  ];

  for (const [merchant, expected] of CASES) {
    it(`reads "${merchant}" as ${expected}`, () => {
      const guess = bestCategory({ merchant, raw: merchant });
      expect(guess?.category).toBe(expected);
    });
  }
});

describe('word order decides a tie', () => {
  /*
   * A business leads its name with its main trade. Both words score
   * identically in the merchant field, so without position the winner is
   * whichever category happens to sit earlier in the internal table —
   * arbitrary, and wrong half the time.
   */
  it('reads "Pharmacy & Grocery" as a pharmacy', () => {
    const guesses = guessCategories({
      merchant: 'A S P Pharmacy & Grocery, LK',
      raw: 'A S P Pharmacy & Grocery, LK',
    });

    expect(guesses[0].category).toBe('health');
    expect(guesses.map((guess) => guess.category)).toContain('groceries');
  });

  it('reads "Grocery & Pharmacy" the other way round', () => {
    // The same two words, reversed — the answer must reverse with them, or the
    // ordering was never really being used.
    const guesses = guessCategories({
      merchant: 'Grocery & Pharmacy Mart',
      raw: 'Grocery & Pharmacy Mart',
    });

    expect(guesses[0].category).toBe('groceries');
  });

  it('separates the two by a real margin, not a hairline tie', () => {
    /*
     * The lead trade must SCORE higher, not merely sort higher.
     *
     * While the two sat at an identical 0.85 the winner depended entirely on
     * the final sort comparator — so any later change to grouping or table
     * order would flip the answer silently, with every test still passing
     * because they only ever asserted `guesses[0]`.
     */
    const [first, second] = guessCategories({
      merchant: 'A S P Pharmacy & Grocery, LK',
      raw: 'A S P Pharmacy & Grocery, LK',
    });

    expect(first.score).toBeGreaterThan(second.score);
  });

  it('does not let position beat a genuinely stronger signal', () => {
    /*
     * Position is a TIEBREAK, not an override. "KEELLS" is a known grocery
     * brand and scores higher than any generic word, so a later brand still
     * wins over an earlier generic term.
     */
    const guesses = guessCategories({
      merchant: 'CITY CAFE at KEELLS SUPER',
      raw: 'CITY CAFE at KEELLS SUPER',
    });

    expect(guesses[0].category).toBe('groceries');
  });
});

describe('weighing the evidence', () => {

  it('trusts the merchant field over the message body', () => {
    // Bank boilerplate mentions all sorts of things; where a word appears is
    // most of what makes it trustworthy.
    const inMerchant = bestCategory({ merchant: 'CITY PHARMACY', raw: 'CITY PHARMACY' });
    const inBodyOnly = guessCategories({
      merchant: 'UNKNOWN SHOP',
      raw: 'debited at UNKNOWN SHOP near the pharmacy on Main St',
    });

    expect(inMerchant?.score).toBeGreaterThan(inBodyOnly[0]?.score ?? 0);
  });

  it('lets the transaction kind override the merchant', () => {
    /*
     * "DFCC bank" as the merchant of an ATM withdrawal is the machine's owner,
     * not a purchase from a bank. The kind is the reliable signal.
     */
    const guess = bestCategory({ merchant: 'DFCC bank , LKA', raw: 'ATM withdrawal', kind: 'atm' });
    expect(guess?.category).toBe('atm');
  });

  it('reports nothing rather than guessing at an opaque merchant', () => {
    // A reference number names nothing, and inventing a category for it would
    // be worse than leaving the user to choose.
    expect(bestCategory({ merchant: 'REF 88213', raw: 'LKR 500.00 debited REF 88213' })).toBeNull();
  });
});

describe('word boundaries', () => {
  it('does not fire on a brand buried inside another word', () => {
    /*
     * The reason containment is checked by hand rather than with `includes`:
     * "ioc" would otherwise match "Biology", and "spar" would match "Sparrow".
     */
    const guesses = guessCategories({ merchant: 'SPARROW BOUTIQUE', raw: 'SPARROW BOUTIQUE' });
    expect(guesses.find((guess) => guess.reasons.includes('spar'))).toBeUndefined();
  });

  it('still matches a multi-word brand', () => {
    expect(bestCategory({ merchant: 'CARGILLS FOOD CITY', raw: 'CARGILLS FOOD CITY' })?.category).toBe(
      'groceries',
    );
  });
});

describe('lineMatchesCategory', () => {
  it('connects a guess to the user\'s own line name', () => {
    // A guess is useless unless it can find the line it belongs to.
    expect(lineMatchesCategory('health', 'Medicine Health')).toBe(true);
    expect(lineMatchesCategory('groceries', 'Groceries Living')).toBe(true);
    expect(lineMatchesCategory('health', 'Groceries Living')).toBe(false);
  });
});
