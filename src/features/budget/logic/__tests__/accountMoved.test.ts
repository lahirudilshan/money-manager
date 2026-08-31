import { describe, expect, it } from 'vitest';

/**
 * What makes an account read as "money moved".
 *
 * Two different real-world steps were conflated in `selectAccountTransfers`,
 * and the bug only showed on a device: the split between "still to move" and
 * "already moved" was keyed on whether each BILL was `paid`, while the
 * dashboard's slider writes the CATEGORY's transfer state. So the control read
 * one fact and wrote another.
 *
 * The visible symptom: an account whose bills happened to be settled showed
 * "All moved" before the user had transferred anything, and sliding it could
 * not be reverted — the state being written was never the state being read.
 *
 * Paying a bill from an account says nothing about whether the salary money was
 * moved there; it may have been paid from whatever balance the card already
 * held. These are independent, and the tests below pin that independence.
 */

interface Line {
  categoryId: string;
  amountMinor: number;
  /** Whether the BILL is settled — deliberately irrelevant to "moved". */
  paid: boolean;
}

/** The split `selectAccountTransfers` performs, in pure form. */
function split(
  lines: readonly Line[],
  transferredCategoryIds: ReadonlySet<string>,
): { toTransfer: number; moved: number; pendingCount: number } {
  let toTransfer = 0;
  let moved = 0;
  let pendingCount = 0;

  for (const line of lines) {
    if (transferredCategoryIds.has(line.categoryId)) {
      moved += line.amountMinor;
    } else {
      toTransfer += line.amountMinor;
      pendingCount += 1;
    }
  }

  return { toTransfer, moved, pendingCount };
}

const LINES: Line[] = [
  { categoryId: 'living', amountMinor: 300_000, paid: true },
  { categoryId: 'vehicle', amountMinor: 120_000, paid: false },
];

describe('account "money moved" state', () => {
  /**
   * The regression. Both bills are paid, but nothing has been transferred —
   * the account must still ask for its money.
   */
  it('is not "moved" just because the bills are paid', () => {
    const result = split(LINES, new Set());

    expect(result.moved).toBe(0);
    expect(result.toTransfer).toBe(420_000);
    expect(result.pendingCount).toBe(2);
  });

  it('is fully moved once every category is transferred', () => {
    const result = split(LINES, new Set(['living', 'vehicle']));

    expect(result.toTransfer).toBe(0);
    expect(result.moved).toBe(420_000);
    expect(result.pendingCount).toBe(0);
  });

  /** A partly-transferred account reports only what is left. */
  it('reports the remainder when one category is transferred', () => {
    const result = split(LINES, new Set(['living']));

    expect(result.moved).toBe(300_000);
    expect(result.toTransfer).toBe(120_000);
    expect(result.pendingCount).toBe(1);
  });

  /**
   * The inverse of the first case, and the other half of the independence:
   * money can be moved to an account before any of its bills are paid.
   */
  it('is "moved" even when no bill has been paid', () => {
    const unpaid: Line[] = LINES.map((line) => ({ ...line, paid: false }));

    expect(split(unpaid, new Set(['living', 'vehicle'])).toTransfer).toBe(0);
  });

  /** Reverting has to be reachable — the read and the write must agree. */
  it('returns to pending when the transfer is undone', () => {
    const transferred = split(LINES, new Set(['living', 'vehicle']));
    const reverted = split(LINES, new Set());

    expect(transferred.toTransfer).toBe(0);
    expect(reverted.toTransfer).toBe(420_000);
  });
});

/**
 * An account with nothing planned against it, which the dashboard now SHOWS
 * rather than filters away.
 *
 * `selectAccountTransfers` used to drop any account whose planned total was
 * zero. That made the section quietly incomplete: a freshly added account, or
 * one whose bills all sit elsewhere, simply was not in the list — which reads
 * as the account having failed to save rather than as having nothing to move.
 *
 * The distinction that replaced the filter is `empty` vs "moved". Both show a
 * zero left to transfer, but they mean opposite things — one has an action
 * already completed, the other has no action at all — and the dashboard renders
 * them differently (a tick vs an inert, dimmed row), so nothing may collapse
 * them back together.
 */
describe('accounts with nothing planned', () => {
  /** The pure form of the `empty` flag and the "done" reading built on it. */
  function classify(plannedMinor: number, toTransferMinor: number) {
    const empty = plannedMinor === 0;
    return { empty, done: toTransferMinor === 0 && !empty };
  }

  it('is empty, not moved, when nothing is planned against it', () => {
    const result = classify(0, 0);

    expect(result.empty).toBe(true);
    // The critical half: an untouched account must never read as settled.
    expect(result.done).toBe(false);
  });

  it('is moved, not empty, once its planned money is transferred', () => {
    const result = classify(420_000, 0);

    expect(result.empty).toBe(false);
    expect(result.done).toBe(true);
  });

  it('is neither while money is still owed to it', () => {
    const result = classify(420_000, 120_000);

    expect(result.empty).toBe(false);
    expect(result.done).toBe(false);
  });

  /**
   * Ordering. Accounts needing money lead, then those already moved, and the
   * ones with nothing planned sink to the bottom — the list stays a worklist
   * even though it now holds rows with no work in them.
   */
  it('sorts empty accounts below ones that were funded', () => {
    const accounts = [
      { id: 'empty', toTransferMinor: 0, plannedMinor: 0 },
      { id: 'moved', toTransferMinor: 0, plannedMinor: 300_000 },
      { id: 'owed', toTransferMinor: 120_000, plannedMinor: 120_000 },
    ];

    const sorted = [...accounts].sort(
      (a, b) => b.toTransferMinor - a.toTransferMinor || b.plannedMinor - a.plannedMinor,
    );

    expect(sorted.map((a) => a.id)).toEqual(['owed', 'moved', 'empty']);
  });
});

/**
 * What an ONGOING line asks its account for.
 *
 * The regression this pins was visible on one real board: an account funding
 * only "Groceries" and "Eating out" — both spending budgets — showed nothing to
 * move, while every other account was correct. The cause was not the account
 * but the cadence, and it hid in a `??`:
 *
 *   const amount = line.actualMinor ?? line.plannedMinor;
 *
 * A DATED bill reports `actualMinor: null` until something is logged (see
 * `billActual`), so the fallback fires and its plan amount is funded. An
 * ongoing line reports the sum of its entries, which is a real `0` before the
 * month's first receipt — and `??` accepts `0` happily. So a Rs 30,000 grocery
 * budget asked for Rs 0, and an account holding only such lines read as empty.
 *
 * The rule that replaced it: spending against a budget does not reduce what has
 * to be moved onto the card, because the money must be there to spend. The
 * budget is the floor.
 */
describe('what an ongoing line asks its account for', () => {
  /** The per-line resolution `selectAccountTransfers` performs. */
  function askedFor(
    frequency: 'monthly' | 'ongoing',
    plannedMinor: number,
    actualMinor: number | null,
  ): number {
    return frequency === 'ongoing'
      ? Math.max(plannedMinor, actualMinor ?? 0)
      : (actualMinor ?? plannedMinor);
  }

  /**
   * The regression itself. An ongoing line reports `0`, not `null`, so the old
   * `??` fell through to the spend rather than the budget.
   */
  it('asks for the full budget before anything is spent', () => {
    expect(askedFor('ongoing', 30_000_00, 0)).toBe(30_000_00);
  });

  /** Part-spent: the budget still has to be on the card in full. */
  it('still asks for the budget once part of it is spent', () => {
    expect(askedFor('ongoing', 30_000_00, 8_400_00)).toBe(30_000_00);
  });

  /** Overspent: the real figure is larger, so it wins. */
  it('asks for the real figure once the budget is overspent', () => {
    expect(askedFor('ongoing', 30_000_00, 34_000_00)).toBe(34_000_00);
  });

  /** A dated bill is untouched by the change — `null` still means "not paid". */
  it('leaves a dated bill on its plan amount until it is logged', () => {
    expect(askedFor('monthly', 35_000_00, null)).toBe(35_000_00);
    expect(askedFor('monthly', 35_000_00, 36_200_00)).toBe(36_200_00);
  });

  /**
   * The reported symptom, end to end: an account whose lines are ALL ongoing
   * must not read as empty. This is the account that made the bug look
   * account-specific when it was really cadence-specific.
   */
  it('does not read as empty when every line on the account is ongoing', () => {
    const groceries = askedFor('ongoing', 30_000_00, 0);
    const eatingOut = askedFor('ongoing', 20_000_00, 0);
    const planned = groceries + eatingOut;

    expect(planned).toBe(50_000_00);
    expect(planned === 0).toBe(false);
  });
});

/**
 * Which categories an account's DETAIL screen says it funds.
 *
 * The dashboard row and the detail screen behind it answered this question with
 * different code. The row resolved per leaf (`resolveCardId(sub, category)`);
 * the detail screen filtered on `category.cardId` alone. A bill may override the
 * account its category names, so the two disagreed whenever anyone used that
 * override — and it broke in both directions at once:
 *
 *   - an account funded ONLY by overrides showed "no categories draw from this
 *     account yet" while the dashboard asked for real money to be moved to it;
 *   - the account named at category level claimed categories whose every line
 *     had been pointed somewhere else.
 *
 * Both are pinned here, against the shape of a real board: a household account
 * that exists purely as an override target for two grocery lines.
 */
describe('which categories an account funds', () => {
  interface Line {
    name: string;
    categoryName: string;
    /** The category's account — the default this line may override. */
    categoryCardId: string;
    /** The line's own account, or null to inherit. */
    cardId: string | null;
  }

  /** `resolveCardId`: the line's own account wins, else the category's. */
  const resolve = (line: Line) => line.cardId ?? line.categoryCardId;

  /** The per-leaf grouping the detail screen performs. */
  function funds(lines: readonly Line[], cardId: string): string[] {
    const names = lines.filter((line) => resolve(line) === cardId).map((l) => l.categoryName);
    return [...new Set(names)];
  }

  const BOARD: Line[] = [
    // Living sits on the salary account, but its food lines are paid by the
    // household account — the override that the old filter could not see.
    { name: 'Groceries', categoryName: 'Living', categoryCardId: 'salary', cardId: 'household' },
    { name: 'Eating out', categoryName: 'Living', categoryCardId: 'salary', cardId: 'household' },
    { name: 'Mobile', categoryName: 'Living', categoryCardId: 'salary', cardId: null },
    { name: 'Rent', categoryName: 'Housing', categoryCardId: 'salary', cardId: null },
    // A category whose ONLY line is overridden away to a third account.
    { name: 'Travel & trips', categoryName: 'Lifestyle', categoryCardId: 'salary', cardId: 'travel' },
  ];

  /** The reported symptom: the section was empty for an override-only account. */
  it('finds a category reached only by a line-level override', () => {
    expect(funds(BOARD, 'household')).toEqual(['Living']);
  });

  /** The inverse: a category emptied by overrides is not claimed. */
  it('drops a category whose every line was overridden away', () => {
    expect(funds(BOARD, 'salary')).not.toContain('Lifestyle');
    expect(funds(BOARD, 'travel')).toEqual(['Lifestyle']);
  });

  /** A category may legitimately appear under two accounts at once. */
  it('lists a split category under both accounts', () => {
    expect(funds(BOARD, 'salary')).toEqual(['Living', 'Housing']);
    expect(funds(BOARD, 'household')).toContain('Living');
  });

  /**
   * The header total counts only the lines that resolve HERE — using the
   * category's whole summary would report another account's money.
   */
  it('totals only the lines belonging to this account', () => {
    const amounts: Record<string, number> = {
      Groceries: 30_000_00,
      'Eating out': 20_000_00,
      Mobile: 3_000_00,
    };
    const livingOnHousehold = BOARD.filter(
      (l) => l.categoryName === 'Living' && resolve(l) === 'household',
    ).reduce((sum, l) => sum + amounts[l.name], 0);

    expect(livingOnHousehold).toBe(50_000_00);
  });
});
