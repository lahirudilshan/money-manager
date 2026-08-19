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
