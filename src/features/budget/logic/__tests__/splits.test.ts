import { describe, expect, it } from 'vitest';
import {
  assignRemainder,
  emptyPart,
  ordinal,
  parsePartAmount,
  splitEvenly,
  toSavedParts,
  validateSplit,
  withAmount,
  type SplitPart,
} from '~/features/budget/logic/splits';

function part(over: Partial<SplitPart> = {}): SplitPart {
  const base: SplitPart = {
    key: 'k',
    subcategoryId: 'sub1',
    ...withAmount(1000),
  };
  return { ...base, ...over };
}

describe('validateSplit', () => {
  it('accepts parts that sum exactly to the payment', () => {
    const result = validateSplit(
      [
        part({ key: 'a', subcategoryId: 'groceries', ...withAmount(300000) }),
        part({ key: 'b', subcategoryId: 'pet', ...withAmount(200000) }),
      ],
      500000,
    );

    expect(result.valid).toBe(true);
    expect(result.remainderMinor).toBe(0);
    expect(result.allocatedMinor).toBe(500000);
  });

  it('reports a shortfall as a positive remainder', () => {
    const result = validateSplit([part({ ...withAmount(200000) })], 500000);
    expect(result.remainderMinor).toBe(300000);
    expect(result.valid).toBe(false);
  });

  // The sign carries the message — over-allocating is a different mistake from
  // under-allocating and the UI says so differently.
  it('reports an overshoot as a negative remainder', () => {
    const result = validateSplit(
      [part({ key: 'a', ...withAmount(400000) }), part({ key: 'b', ...withAmount(400000) })],
      500000,
    );
    expect(result.remainderMinor).toBe(-300000);
    expect(result.valid).toBe(false);
  });

  // One part is the transaction itself; calling it a split would be noise.
  it('refuses a single part even when it covers the whole amount', () => {
    const result = validateSplit([part({ ...withAmount(500000) })], 500000);
    expect(result.valid).toBe(false);
    expect(result.usableCount).toBe(1);
  });

  /*
   * The bug the user hit, verbatim.
   *
   * The editor keeps a spare row to type the next part into, so a finished
   * split of 3,800 + 6,200 against 10,000 arrives here with THREE parts, one
   * of them blank. The old rule (`usable.length === parts.length`) called that
   * invalid, so the screen showed "SETTLED, 0.00 left" and the "Log it" button
   * stayed greyed out with no reason given — indistinguishable from a button
   * that simply does not work.
   */
  it('saves a settled split even with a trailing empty row', () => {
    const result = validateSplit(
      [
        part({ key: 'a', subcategoryId: 'dining', ...withAmount(380000) }),
        part({ key: 'b', subcategoryId: 'groceries', ...withAmount(620000) }),
        part({ key: 'c', subcategoryId: null, amountMinor: null, amountText: '' }),
      ],
      1000000,
    );

    expect(result.remainderMinor).toBe(0);
    expect(result.valid).toBe(true);
    expect(result.incompleteCount).toBe(0);
  });

  /*
   * A row the user STARTED is different from one they never touched: it says
   * they meant to allocate something and have not finished saying what, so it
   * must still block the save.
   */
  it('still refuses a line chosen with no amount', () => {
    const result = validateSplit(
      [
        part({ key: 'a', subcategoryId: 'dining', ...withAmount(380000) }),
        part({ key: 'b', subcategoryId: 'groceries', ...withAmount(620000) }),
        part({ key: 'c', subcategoryId: 'pet', amountMinor: null, amountText: '' }),
      ],
      1000000,
    );

    expect(result.remainderMinor).toBe(0);
    expect(result.valid).toBe(false);
    expect(result.incompleteCount).toBe(1);
  });

  it('still refuses an amount with no line', () => {
    const result = validateSplit(
      [
        part({ key: 'a', subcategoryId: 'dining', ...withAmount(380000) }),
        part({ key: 'b', subcategoryId: 'groceries', ...withAmount(620000) }),
        part({ key: 'c', subcategoryId: null, ...withAmount(500) }),
      ],
      1000000,
    );

    expect(result.valid).toBe(false);
    expect(result.incompleteCount).toBe(1);
  });

  it('treats a half-filled row as unallocated rather than invalid', () => {
    const result = validateSplit(
      [
        part({ key: 'a', ...withAmount(300000) }),
        part({ key: 'b', subcategoryId: null, amountMinor: null }),
      ],
      500000,
    );
    expect(result.allocatedMinor).toBe(300000);
    expect(result.remainderMinor).toBe(200000);
    expect(result.valid).toBe(false);
  });
});

describe('toSavedParts', () => {
  /*
   * The other half of the empty-row fix. `validateSplit` now allows a blank
   * row through, so the thing that writes to the database has to drop it —
   * otherwise the screens' old `parts.map(p => p.subcategoryId!)` would send a
   * part belonging to no line at all.
   */
  it('drops a trailing empty row', () => {
    const saved = toSavedParts([
      part({ key: 'a', subcategoryId: 'dining', ...withAmount(380000) }),
      part({ key: 'b', subcategoryId: 'groceries', ...withAmount(620000) }),
      part({ key: 'c', subcategoryId: null, amountMinor: null, amountText: '' }),
    ]);

    expect(saved).toEqual([
      { subcategoryId: 'dining', amountMinor: 380000, note: null },
      { subcategoryId: 'groceries', amountMinor: 620000, note: null },
    ]);
  });

  it('never emits a part with no line', () => {
    const saved = toSavedParts([
      part({ key: 'a', subcategoryId: null, ...withAmount(100) }),
      part({ key: 'b', subcategoryId: 'x', amountMinor: null, amountText: '' }),
    ]);
    expect(saved).toEqual([]);
  });

  it('keeps a note the user wrote on a part', () => {
    const saved = toSavedParts([
      part({ key: 'a', subcategoryId: 'pet', ...withAmount(200), note: 'pet food' }),
      part({ key: 'b', subcategoryId: 'food', ...withAmount(300) }),
    ]);
    expect(saved[0].note).toBe('pet food');
    expect(saved[1].note).toBeNull();
  });

  /* What the store writes must be exactly what the validator approved. */
  it('agrees with validateSplit about what counts', () => {
    const parts = [
      part({ key: 'a', subcategoryId: 'dining', ...withAmount(380000) }),
      part({ key: 'b', subcategoryId: 'groceries', ...withAmount(620000) }),
      part({ key: 'c', subcategoryId: null, amountMinor: null, amountText: '' }),
    ];
    const validation = validateSplit(parts, 1000000);
    const saved = toSavedParts(parts);

    expect(validation.valid).toBe(true);
    expect(saved).toHaveLength(validation.usableCount);
    expect(saved.reduce((sum, p) => sum + p.amountMinor, 0)).toBe(1000000);
  });
});

describe('splitEvenly', () => {
  it('divides evenly when it divides evenly', () => {
    expect(splitEvenly(600, 3)).toEqual([200, 200, 200]);
  });

  // The parts must still sum exactly — an integer division that drops the
  // remainder is money vanishing.
  it('hands the remainder out from the front, one unit at a time', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles a count larger than the amount', () => {
    expect(splitEvenly(2, 3)).toEqual([1, 1, 0]);
  });

  it('returns nothing for a non-positive count', () => {
    expect(splitEvenly(1000, 0)).toEqual([]);
  });
});

describe('assignRemainder', () => {
  it('fills the first empty amount with what is left', () => {
    const result = assignRemainder(
      [
        part({ key: 'a', ...withAmount(200000) }),
        part({ key: 'b', subcategoryId: 'groceries', amountMinor: null }),
      ],
      500000,
    );
    expect(result[1].amountMinor).toBe(300000);
    expect(validateSplit(result, 500000).valid).toBe(true);
  });

  it('leaves the parts alone when nothing is left over', () => {
    const parts = [
      part({ key: 'a', ...withAmount(250000) }),
      part({ key: 'b', ...withAmount(250000) }),
    ];
    expect(assignRemainder(parts, 500000)).toEqual(parts);
  });

  it('leaves the parts alone when every row already has an amount', () => {
    const parts = [part({ key: 'a', ...withAmount(100000) })];
    expect(assignRemainder(parts, 500000)).toEqual(parts);
  });
});

/**
 * The typing bug.
 *
 * The editor first stored only `amountMinor` and re-rendered the input as
 * `(amountMinor / 100).toFixed(2)`. Typing "2" therefore stored 2 minor units,
 * which rendered back as "0.02" — moving the caret and turning every following
 * keystroke into nonsense, so "2000" simply could not be entered. These pin the
 * arrangement that fixes it: the TEXT is what the user owns, the number is
 * derived from it.
 */
describe('parsePartAmount', () => {
  it('reads a plain whole number as major units', () => {
    expect(parsePartAmount('2000')).toBe(200000);
    expect(parsePartAmount('2')).toBe(200);
  });

  it('reads decimals', () => {
    expect(parsePartAmount('12.50')).toBe(1250);
    expect(parsePartAmount('0.05')).toBe(5);
  });

  // `formatAmountInput` reinserts thousands separators on every keystroke, so
  // the stored text routinely contains commas.
  it('tolerates the separators the input control adds', () => {
    expect(parsePartAmount('1,250.50')).toBe(125050);
    expect(parsePartAmount('12,000')).toBe(1200000);
  });

  /*
   * The half-finished shapes typing passes through must read as "nothing yet",
   * NOT as zero — a zero counts as allocated and would make the remainder claim
   * the row was already finished.
   */
  it('returns null for empty or half-typed text rather than zero', () => {
    expect(parsePartAmount('')).toBeNull();
    expect(parsePartAmount('.')).toBeNull();
    expect(parsePartAmount('abc')).toBeNull();
    expect(parsePartAmount('0')).toBeNull();
  });

  it('rounds rather than truncating, so a split is never a cent short', () => {
    expect(parsePartAmount('0.1')).toBe(10);
    expect(parsePartAmount('33.335')).toBe(3334);
  });

  /*
   * The heart of it: typing "2000" one character at a time must pass through
   * 2 -> 20 -> 200 -> 2000 as MAJOR units. Under the old derived-display
   * arrangement the field fought back after the first keystroke.
   */
  it('reads each prefix of a number being typed as that number', () => {
    expect(['2', '20', '200', '2000'].map(parsePartAmount)).toEqual([
      200, 2000, 20000, 200000,
    ]);
  });
});

describe('withAmount', () => {
  it('sets the text and the value together', () => {
    expect(withAmount(200000)).toEqual({ amountMinor: 200000, amountText: '2000.00' });
  });

  // A programmatically-set amount must read back as the same number, or
  // "split evenly" would change the total the moment the field re-parsed.
  it('round-trips through parsePartAmount', () => {
    for (const minor of [1, 5, 1250, 200000, 333333]) {
      expect(parsePartAmount(withAmount(minor).amountText)).toBe(minor);
    }
  });
});

describe('emptyPart', () => {
  it('starts blank, not zero', () => {
    const fresh = emptyPart();
    expect(fresh.amountMinor).toBeNull();
    expect(fresh.amountText).toBe('');
    expect(fresh.subcategoryId).toBeNull();
  });

  // Keys must not collide, or React carries a removed row's input state into
  // the row that replaces it.
  it('gives every part a distinct key', () => {
    const keys = new Set(Array.from({ length: 50 }, () => emptyPart().key));
    expect(keys.size).toBe(50);
  });
});

describe('the helpers keep text and value in step', () => {
  it('splitEvenly via withAmount leaves every part readable', () => {
    const parts = [part({ key: 'a' }), part({ key: 'b' }), part({ key: 'c' })];
    const amounts = splitEvenly(100000, parts.length);
    const next = parts.map((p, i) => ({ ...p, ...withAmount(amounts[i]) }));

    expect(validateSplit(next, 100000).valid).toBe(true);
    for (const p of next) expect(parsePartAmount(p.amountText)).toBe(p.amountMinor);
  });

  it('assignRemainder fills the text as well as the value', () => {
    const result = assignRemainder(
      [part({ key: 'a', ...withAmount(200000) }), { ...emptyPart(), key: 'b', subcategoryId: 'x' }],
      500000,
    );
    expect(result[1].amountMinor).toBe(300000);
    // The bug this guards: setting the value alone leaves the box looking empty.
    expect(result[1].amountText).toBe('3000.00');
  });
});

describe('ordinal', () => {
  it('uses the right suffix for the common cases', () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(['1ST', '2ND', '3RD', '4TH', '5TH']);
  });

  // The case that ships wrong when nobody checks: 11/12/13 take TH, not
  // ST/ND/RD, and a long receipt really does reach them.
  it('honours the 11/12/13 exception', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11TH', '12TH', '13TH']);
  });

  it('goes back to the normal suffixes at 21', () => {
    expect([21, 22, 23, 24].map(ordinal)).toEqual(['21ST', '22ND', '23RD', '24TH']);
  });

  it('handles 111/112/113, where the exception applies again', () => {
    expect([111, 112, 113].map(ordinal)).toEqual(['111TH', '112TH', '113TH']);
  });
});
