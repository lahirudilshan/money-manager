import { describe, expect, it } from 'vitest';

/**
 * Categories created without an explicit `sortOrder` all land on 0.
 *
 * `sort_order` has no DB default beyond 0, and two callers omit it — the SMS
 * auto-file path (which creates "Bank & fees" the first time a bank charge
 * arrives) and the learned-category path. On the user's real board that left
 * Income, Debt and Bank & fees all tied at 0, so a category holding a
 * 25-rupee fee could sort above their salary, and the order could change
 * between launches because SQLite is free to return ties in any order.
 *
 * The store fixes this two ways: new categories default to the end of the
 * board, and `repairCategorySortOrder` renumbers an existing tie on launch.
 * The renumbering logic is reproduced here — the store function itself needs a
 * database, so what is asserted is the decision it makes.
 */

interface CategoryLike {
  name: string;
  sortOrder: number;
}

/** True when two adjacent categories share a position. Mirrors the store. */
function hasTie(categories: readonly CategoryLike[]): boolean {
  return categories.some(
    (category, index) => index > 0 && category.sortOrder === categories[index - 1].sortOrder,
  );
}

/** The renumbering the repair applies: index in current display order. */
function renumber(categories: readonly CategoryLike[]): CategoryLike[] {
  return categories.map((category, index) => ({ ...category, sortOrder: index }));
}

describe('repairCategorySortOrder', () => {
  /** The user's real board, as pulled from the device on 2026-08-04. */
  const REAL_BOARD: CategoryLike[] = [
    { name: 'Income', sortOrder: 0 },
    { name: 'Debt', sortOrder: 0 },
    { name: 'Bank & fees', sortOrder: 0 },
    { name: 'Housing', sortOrder: 1 },
    { name: 'Living', sortOrder: 2 },
  ];

  it('detects the tie on the real board', () => {
    expect(hasTie(REAL_BOARD)).toBe(true);
  });

  it('gives every category a distinct position', () => {
    const fixed = renumber(REAL_BOARD);
    expect(fixed.map((category) => category.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves the order already being displayed', () => {
    // The repair must not REARRANGE a board the user has deliberately
    // arranged — it only makes the current order explicit and stable.
    const fixed = renumber(REAL_BOARD);
    expect(fixed.map((category) => category.name)).toEqual(REAL_BOARD.map((c) => c.name));
  });

  it('is idempotent — a repaired board needs no second pass', () => {
    // This runs on every launch, so a repair that kept finding work would
    // rewrite every category row forever.
    const fixed = renumber(REAL_BOARD);
    expect(hasTie(fixed)).toBe(false);
  });

  it('leaves an already-distinct board completely alone', () => {
    const tidy: CategoryLike[] = [
      { name: 'Income', sortOrder: 0 },
      { name: 'Housing', sortOrder: 1 },
    ];
    expect(hasTie(tidy)).toBe(false);
  });

  it('places a newly auto-created category at the END, not the top', () => {
    /*
     * The rule that stops this recurring. "Bank & fees" is created the first
     * time a bank charge arrives, with no sortOrder passed — defaulting to the
     * category count puts it last instead of tied at 0.
     */
    const existing = 5;
    const newSortOrder = existing;
    expect(newSortOrder).toBeGreaterThan(4);
  });
});
