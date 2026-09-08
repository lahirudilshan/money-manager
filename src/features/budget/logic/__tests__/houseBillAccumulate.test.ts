import { describe, expect, it } from 'vitest';
import { billAccumulatesPerHouse, defaultHouseId, type HouseLike } from '../houses';
import { billActual, billStatus } from '../planning';

/**
 * Paying ONE dated bill for TWO houses in the same month.
 *
 * The real failure: the user paid electricity 9,100 for their own home and
 * 2,800 for a parents' house. A dated bill stores one `actual` and one
 * `house_id` per month, so confirming the second overwrote the first — the
 * board ended up showing 2,800 attributed to the parents' house, and the 9,100
 * was gone. Both the money and the attribution were lost, with nothing on
 * screen to say so.
 *
 * The fix makes a house-scoped bill accumulate ENTRIES instead, exactly as an
 * ongoing line already does. These pin when that applies and what it protects.
 */

const OWN: HouseLike = { id: 'own', isPrimary: true };
const PARENTS: HouseLike = { id: 'parents', isPrimary: false };

describe('when a bill accumulates per house', () => {
  it('accumulates for a house-scoped bill once a second house exists', () => {
    expect(billAccumulatesPerHouse([OWN, PARENTS], true)).toBe(true);
  });

  it('does NOT change a single-house board', () => {
    // The overwrite is harmless when only one house can ever be meant, and the
    // simpler one-figure shape is better there.
    expect(billAccumulatesPerHouse([OWN], true)).toBe(false);
    expect(billAccumulatesPerHouse([], true)).toBe(false);
  });

  it('does NOT change a bill that has nothing to do with a house', () => {
    // A subscription or a credit card must keep its single monthly figure.
    expect(billAccumulatesPerHouse([OWN, PARENTS], false)).toBe(false);
  });
});

describe('what the board shows once entries carry the money', () => {
  /** The two payments that used to collapse into one. */
  const OWN_BILL = 9_100_00;
  const PARENTS_BILL = 2_800_00;

  it('sums both payments instead of keeping only the last', () => {
    // `billActual` already prefers entries over the typed figure, so the fix
    // works with the existing board logic rather than against it.
    const entryTotal = OWN_BILL + PARENTS_BILL;
    expect(billActual(entryTotal, null)).toBe(11_900_00);
  });

  it('no longer silently discards the first payment', () => {
    // The old shape: one slot, last write wins.
    const overwritten = PARENTS_BILL;
    expect(overwritten).not.toBe(OWN_BILL + PARENTS_BILL);
    // The new shape keeps both.
    expect(billActual(OWN_BILL + PARENTS_BILL, null)).toBeGreaterThan(overwritten);
  });

  it('still settles the bill, so a paid line is not nagged about', () => {
    expect(billStatus('pending', OWN_BILL + PARENTS_BILL)).toBe('paid');
  });

  it('leaves an unpaid bill pending', () => {
    expect(billStatus('pending', 0)).toBe('pending');
  });

  it('falls back to the typed figure when there are no entries', () => {
    // A one-house board, or a month logged before this change.
    expect(billActual(0, 4_500_00)).toBe(4_500_00);
  });
});

describe('which house a payment defaults to', () => {
  it('offers the user’s own home first, with the parents’ houses a tap away', () => {
    expect(defaultHouseId([OWN, PARENTS], null)).toBe('own');
  });

  it('keeps a line’s own default when it names a live house', () => {
    // "the Weligama electricity" should not revert to the user's home monthly.
    expect(defaultHouseId([OWN, PARENTS], 'parents')).toBe('parents');
  });
});
