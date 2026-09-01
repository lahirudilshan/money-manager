import { describe, expect, it } from 'vitest';
import { hasSiblingTie, nextSiblingSortOrder, renumberSiblings } from '~/features/budget/logic/sortOrder';

/**
 * The same collision as `categorySortOrder`, one level down — and the reason
 * dragging a bill inside a category did nothing on the user's real board.
 *
 * `addSubcategory` used to derive a new line's position from `siblings.length`,
 * which is only correct when a category's existing bills occupy a dense
 * `0..n-1` range. Onboarding does not produce that: it walks its catalog and
 * hands out board-WIDE offsets, so "Living" was created holding 4,5,6,7,8,9.
 * Adding one more bill then computed 8 sibling rows → sortOrder 7, tying with
 * the two lines already sitting at 7.
 *
 * A tie is not merely cosmetic here. `subcategoryRepo.byCategory` orders by
 * `sort_order` alone, so SQLite may return tied rows in any order it likes —
 * the list renders one arrangement, the drag writes indexes against it, and the
 * next read comes back in a different order, which is exactly the "drag does
 * nothing / snaps back" symptom.
 */
describe('subcategory sort order', () => {
  /** "Living", exactly as pulled off the device on 2026-09-01. */
  const REAL_LIVING = [
    { name: 'Rent / mortgage', sortOrder: 4 },
    { name: 'Electricity bill', sortOrder: 5 },
    { name: 'Water bill', sortOrder: 6 },
    { name: 'Wifi bill', sortOrder: 7 },
    { name: 'Groceries (home food)', sortOrder: 7 },
    { name: 'Cash / pocket money', sortOrder: 7 },
    { name: 'Eating out & delivery', sortOrder: 8 },
    { name: 'Mobile / phone bill', sortOrder: 9 },
  ];

  it('detects the tie on the real board', () => {
    expect(hasSiblingTie(REAL_LIVING)).toBe(true);
  });

  it('appends past a SPARSE range instead of colliding with it', () => {
    /*
     * The actual regression. Before the fix this returned the sibling COUNT
     * (8 rows → 7), landing on top of "Wifi bill" and "Groceries". The new
     * line must sort after every existing one whatever range they occupy.
     */
    const beforeCashWasAdded = REAL_LIVING.filter((l) => l.name !== 'Cash / pocket money');
    expect(nextSiblingSortOrder(beforeCashWasAdded)).toBe(10);
  });

  it('starts an empty category at 0', () => {
    expect(nextSiblingSortOrder([])).toBe(0);
  });

  it('gives every bill a distinct position', () => {
    const fixed = renumberSiblings(REAL_LIVING);
    expect(fixed.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('preserves the order already being displayed', () => {
    // The repair makes the current arrangement explicit; it must not reshuffle
    // bills the user deliberately arranged.
    const fixed = renumberSiblings(REAL_LIVING);
    expect(fixed.map((l) => l.name)).toEqual(REAL_LIVING.map((l) => l.name));
  });

  it('is idempotent — a repaired category needs no second pass', () => {
    expect(hasSiblingTie(renumberSiblings(REAL_LIVING))).toBe(false);
  });

  it('leaves an already-dense category alone', () => {
    const tidy = [
      { name: 'Fuel', sortOrder: 0 },
      { name: 'Insurance', sortOrder: 1 },
    ];
    expect(hasSiblingTie(tidy)).toBe(false);
    expect(nextSiblingSortOrder(tidy)).toBe(2);
  });
});
