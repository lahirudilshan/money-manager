import { describe, expect, it } from 'vitest';
import { budgetedSpendMinor, type HouseLike } from '../houses';

/**
 * Which spend a budget is judged against when one line pays for two houses.
 *
 * The user's real board: electricity 9,100 for their own home and 2,800 for a
 * parents' house, against an 8,000 budget set for their own home. Summing both
 * reported "11,900 — 3,900 over", making their own usage look far worse than
 * the 1,100 it actually is. Support sent to another household is real spending
 * but not overspending on this budget.
 */

const OWN: HouseLike = { id: 'own', isPrimary: true };
const WELIGAMA: HouseLike = { id: 'weligama', isPrimary: false };
const HOUSES = [OWN, WELIGAMA];

/** September's real electricity payments. */
const ELECTRICITY = [
  { houseId: 'own', amountMinor: 9_100_00 },
  { houseId: 'weligama', amountMinor: 2_800_00 },
];

describe('judging a budget on a multi-house line', () => {
  it('counts only the primary house', () => {
    expect(budgetedSpendMinor(ELECTRICITY, HOUSES, true)).toBe(9_100_00);
  });

  it('turns a misleading 3,900 over into the true 1,100 over', () => {
    const BUDGET = 8_000_00;
    const naive = ELECTRICITY.reduce((s, e) => s + e.amountMinor, 0) - BUDGET;
    const real = budgetedSpendMinor(ELECTRICITY, HOUSES, true) - BUDGET;
    expect(naive).toBe(3_900_00);
    expect(real).toBe(1_100_00);
  });

  it('counts an untagged entry as the user’s own', () => {
    /*
     * Untagged predates houses or was logged without choosing one. Treating it
     * as someone else's would shrink the budgeted figure and make an overspent
     * line look healthy.
     */
    const withUntagged = [...ELECTRICITY, { houseId: null, amountMinor: 500_00 }];
    expect(budgetedSpendMinor(withUntagged, HOUSES, true)).toBe(9_600_00);
  });
});

describe('leaving every other line exactly as it was', () => {
  it('uses the full total on a single-house board', () => {
    expect(budgetedSpendMinor(ELECTRICITY, [OWN], true)).toBe(11_900_00);
  });

  it('uses the full total for a line that is not house-scoped', () => {
    // A subscription or a card must keep comparing against everything.
    expect(budgetedSpendMinor(ELECTRICITY, HOUSES, false)).toBe(11_900_00);
  });

  it('uses the full total when no house is marked primary', () => {
    // Nothing to separate by, so separating would be a guess.
    const noPrimary = [{ id: 'a', isPrimary: false }, { id: 'b', isPrimary: false }];
    expect(budgetedSpendMinor(ELECTRICITY, noPrimary, true)).toBe(11_900_00);
  });

  it('uses the full total when no entry carries a house yet', () => {
    const untagged = [
      { houseId: null, amountMinor: 4_000_00 },
      { houseId: null, amountMinor: 1_000_00 },
    ];
    expect(budgetedSpendMinor(untagged, HOUSES, true)).toBe(5_000_00);
  });

  it('is zero for a month with no payments', () => {
    expect(budgetedSpendMinor([], HOUSES, true)).toBe(0);
  });

  it('is zero when every payment was for another house', () => {
    // Nothing spent on the user's own home means nothing against its budget.
    const onlyTheirs = [{ houseId: 'weligama', amountMinor: 2_800_00 }];
    expect(budgetedSpendMinor(onlyTheirs, HOUSES, true)).toBe(0);
  });
});
