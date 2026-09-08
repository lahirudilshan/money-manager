import { describe, expect, it } from 'vitest';
import { fileUnderHouseLine, houseForLine } from '../houses';

/**
 * Filing a bill under the house it was paid for.
 *
 * The user pays electricity and water for their own home AND for a parents'
 * house. Those are different kinds of spending: one is their utility bill,
 * the other is support sent to another household. Keeping both on one
 * "Electricity" line made the user's own budget look overspent by money that
 * was never theirs to begin with.
 *
 * So naming a house in Smart Detect FILES the payment under that house's line.
 * Only the user's own home stays on the bill line, which is what it is for.
 */

const HOUSES = [
  { id: 'own', name: 'My home', isPrimary: true },
  { id: 'kelaniya', name: 'Kelaniya', isPrimary: false },
  { id: 'weligama', name: 'Weligama', isPrimary: false },
];

/** The property lines on the board, paired with the house each stands for. */
const HOUSE_LINES = [
  { subcategoryId: 'plan_sub_house-own', houseId: 'kelaniya' },
  { subcategoryId: 'plan_sub_house-parents', houseId: 'weligama' },
];

describe('matching a house line to its house', () => {
  it('links "Weligama home" to the Weligama house', () => {
    expect(houseForLine('Weligama home', HOUSES)).toBe('weligama');
    expect(houseForLine('Kelaniya home', HOUSES)).toBe('kelaniya');
  });

  it('is case-insensitive', () => {
    expect(houseForLine('WELIGAMA HOME', HOUSES)).toBe('weligama');
  });

  it('does not match a line that merely contains the letters', () => {
    // Whole-word only: a substring match would attribute unrelated money.
    expect(houseForLine('Weligamaland fund', HOUSES)).toBeNull();
  });

  it('returns null for a line naming no house', () => {
    expect(houseForLine('Electricity bill', HOUSES)).toBeNull();
  });

  it('prefers the most specific house when names overlap', () => {
    const overlapping = [
      { id: 'w', name: 'Weligama', isPrimary: false },
      { id: 'wb', name: 'Weligama beach', isPrimary: false },
    ];
    expect(houseForLine('Weligama beach home', overlapping)).toBe('wb');
  });
});

describe('where a confirmed payment is filed', () => {
  it('files a parents’-house bill under that house’s line', () => {
    // The 2,800 electricity bill for Weligama goes to Weligama home.
    expect(fileUnderHouseLine('weligama', HOUSES, HOUSE_LINES)).toBe('plan_sub_house-parents');
    expect(fileUnderHouseLine('kelaniya', HOUSES, HOUSE_LINES)).toBe('plan_sub_house-own');
  });

  it('leaves the user’s OWN bill on the bill line', () => {
    // The 9,100 stays on Electricity, judged against the electricity budget.
    expect(fileUnderHouseLine('own', HOUSES, HOUSE_LINES)).toBeNull();
  });

  it('leaves a payment alone when no house was chosen', () => {
    expect(fileUnderHouseLine(null, HOUSES, HOUSE_LINES)).toBeNull();
  });

  it('leaves it alone when the board has no line for that house', () => {
    /*
     * Nowhere to file it, so it stays where the user can see it. Dropping it
     * or inventing a line would lose or misplace a real payment.
     */
    expect(fileUnderHouseLine('weligama', HOUSES, [])).toBeNull();
  });

  it('files normally when no house is marked primary', () => {
    // Without a primary there is no "own home" to exempt, so the mapping
    // decides on its own rather than guessing which house is the user's.
    const noPrimary = HOUSES.map((h) => ({ ...h, isPrimary: false }));
    expect(fileUnderHouseLine('weligama', noPrimary, HOUSE_LINES)).toBe('plan_sub_house-parents');
  });
});
