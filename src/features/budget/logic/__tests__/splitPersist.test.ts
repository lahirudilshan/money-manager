import { describe, expect, it } from 'vitest';
import { validateSplit, type SplitPart } from '../splits';

/**
 * What the review screen hands the store, for the split the user actually made.
 *
 * The bug was never in the store — `confirmDraft` writes splits correctly. It
 * was that the footer offered "Yes, that's right", which calls a handler that
 * passes no parts at all. These pin the contract between the two: what the
 * screen sends, and when it is allowed to send it.
 */

const part = (subcategoryId: string | null, minor: number | null, note?: string): SplitPart => ({
  key: `${subcategoryId}-${minor}`,
  subcategoryId,
  amountMinor: minor,
  amountText: minor === null ? '' : String(minor / 100),
  note: note ?? null,
});

/** `logIt`'s rule: parts travel only when the split is complete. */
function payload(parts: readonly SplitPart[], totalMinor: number, splitting: boolean) {
  const validation = validateSplit(parts, totalMinor);
  if (!splitting || !validation.valid) return undefined;
  return parts.map((p) => ({
    subcategoryId: p.subcategoryId!,
    amountMinor: p.amountMinor!,
    note: p.note ?? null,
  }));
}

const TOTAL = 73_000_00;

describe('the payload the review screen sends', () => {
  it('carries every part once the split adds up', () => {
    const parts = [
      part('groceries', 53_000_00, 'Groceries for the month'),
      part('people', 20_000_00),
    ];
    expect(payload(parts, TOTAL, true)).toEqual([
      { subcategoryId: 'groceries', amountMinor: 53_000_00, note: 'Groceries for the month' },
      { subcategoryId: 'people', amountMinor: 20_000_00, note: null },
    ]);
  });

  /** The user's original attempt: 53,000 + 2,000 left 18,000 unallocated. */
  it('sends nothing while a remainder is left over', () => {
    const parts = [part('groceries', 53_000_00), part('people', 2_000_00)];
    expect(payload(parts, TOTAL, true)).toBeUndefined();
  });

  it('sends nothing when a part has no line chosen', () => {
    const parts = [part('groceries', 53_000_00), part(null, 20_000_00)];
    expect(payload(parts, TOTAL, true)).toBeUndefined();
  });

  it('sends nothing when the editor was never opened', () => {
    const parts = [part('groceries', 53_000_00), part('people', 20_000_00)];
    expect(payload(parts, TOTAL, false)).toBeUndefined();
  });

  /** Notes are optional and travel per part, not per transaction. */
  it('carries a note on the part that has one, null on the rest', () => {
    const parts = [part('a', 40_000_00, 'Weekly shop'), part('b', 33_000_00)];
    const sent = payload(parts, TOTAL, true)!;
    expect(sent[0].note).toBe('Weekly shop');
    expect(sent[1].note).toBeNull();
  });
});
