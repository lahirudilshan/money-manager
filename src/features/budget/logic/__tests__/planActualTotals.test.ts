import { describe, expect, it } from 'vitest';
import { summariseCategory, type PlannedCategory } from '~/features/budget/logic/planning';

/**
 * Plan and actual as separate sums on a category row.
 *
 * The row used to show one blended figure — each line's actual where it had
 * one, its plan where it did not. That answers "what does this category cost
 * this month" and cannot answer "am I over": a category planned at 50,000
 * that has spent 62,000 showed 62,000, and nothing said which it was.
 */

const line = (over: Partial<PlannedCategory> = {}): PlannedCategory =>
  ({
    id: 'l1',
    name: 'Line',
    plannedMinor: 0,
    actualMinor: null,
    frequency: 'monthly',
    type: 'expense',
    ...over,
  }) as PlannedCategory;

describe('plannedTotalMinor and actualTotalMinor', () => {
  it('separates the plan from what was logged', () => {
    const summary = summariseCategory([
      line({ id: 'a', plannedMinor: 50_000_00, actualMinor: 62_000_00 }),
      line({ id: 'b', plannedMinor: 10_000_00, actualMinor: null }),
    ], 0);

    expect(summary.plannedTotalMinor).toBe(60_000_00);
    expect(summary.actualTotalMinor).toBe(62_000_00);
  });

  /* The blended figure stays as it was — other screens depend on it. */
  it('leaves totalMinor alone', () => {
    const summary = summariseCategory([
      line({ id: 'a', plannedMinor: 50_000_00, actualMinor: 62_000_00 }),
      line({ id: 'b', plannedMinor: 10_000_00, actualMinor: null }),
    ], 0);

    // 62,000 actual + 10,000 plan: actual-or-planned, per line.
    expect(summary.totalMinor).toBe(72_000_00);
  });

  it('reports zero spent when nothing has been logged', () => {
    const summary = summariseCategory([line({ plannedMinor: 10_000_00 })], 0);
    expect(summary.plannedTotalMinor).toBe(10_000_00);
    expect(summary.actualTotalMinor).toBe(0);
  });

  /*
   * The shape that makes the row worth changing: real spending against no
   * plan at all. Previously indistinguishable from a plan of that size.
   */
  it('shows spending on a line with no budget', () => {
    const summary = summariseCategory([line({ plannedMinor: 0, actualMinor: 154_460_00 })], 0);
    expect(summary.plannedTotalMinor).toBe(0);
    expect(summary.actualTotalMinor).toBe(154_460_00);
  });

  /*
   * All three figures must normalise a yearly bill the same way, or the row's
   * own numbers would not add up.
   */
  it('spreads a yearly bill in both sums, as totalMinor does', () => {
    const summary = summariseCategory([
      line({ plannedMinor: 120_000_00, actualMinor: 120_000_00, frequency: 'yearly' }),
    ], 0);

    expect(summary.plannedTotalMinor).toBe(10_000_00);
    expect(summary.actualTotalMinor).toBe(10_000_00);
    expect(summary.totalMinor).toBe(10_000_00);
  });

  /* Income is excluded from every spend figure, as it already was. */
  it('ignores income lines', () => {
    const summary = summariseCategory([
      line({ id: 'a', plannedMinor: 10_000_00 }),
      line({ id: 'b', plannedMinor: 750_000_00, type: 'income' }),
    ], 0);

    expect(summary.plannedTotalMinor).toBe(10_000_00);
  });

  it('is zero for an empty category', () => {
    const summary = summariseCategory([], 0);
    expect(summary.plannedTotalMinor).toBe(0);
    expect(summary.actualTotalMinor).toBe(0);
  });
});
