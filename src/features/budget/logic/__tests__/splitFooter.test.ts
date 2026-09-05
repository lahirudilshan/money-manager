import { describe, expect, it } from 'vitest';
import { validateSplit, type SplitPart } from '../splits';

/**
 * Which footer action the review screen offers, and why it matters.
 *
 * The screen has two: "Yes, that's right", which accepts the SUGGESTION and
 * carries no parts, and "Log it", which carries them. The footer chose between
 * them on `!picking && suggested !== null` alone — so opening the split editor
 * (which renders below the confirm card) left the accepting button in place.
 *
 * Observed on the user's board: a LKR 73,000 payment split 53,000 / 2,000 was
 * saved whole into the suggested line, the parts silently discarded, with
 * nothing on screen to explain it.
 */

/** The footer's rule, after the fix. */
function showsConfirmCard(state: {
  picking: boolean;
  splitting: boolean;
  hasSuggestion: boolean;
}): boolean {
  return !state.picking && !state.splitting && state.hasSuggestion;
}

const part = (subcategoryId: string | null, amountMinor: number | null): SplitPart => ({
  key: `${subcategoryId}-${amountMinor}`,
  subcategoryId,
  amountMinor,
  amountText: amountMinor === null ? '' : String(amountMinor / 100),
  note: null,
});

describe('the footer while splitting', () => {
  /** The regression: splitting must retire the accepting button. */
  it('does NOT offer the one-tap confirm once a split is open', () => {
    expect(showsConfirmCard({ picking: false, splitting: true, hasSuggestion: true })).toBe(false);
  });

  it('offers it on the ordinary confident path', () => {
    expect(showsConfirmCard({ picking: false, splitting: false, hasSuggestion: true })).toBe(true);
  });

  it('does not offer it while picking a different category', () => {
    expect(showsConfirmCard({ picking: true, splitting: false, hasSuggestion: true })).toBe(false);
  });

  it('does not offer it when nothing was suggested', () => {
    expect(showsConfirmCard({ picking: false, splitting: false, hasSuggestion: false })).toBe(false);
  });
});

describe('the split the user actually made', () => {
  const TOTAL = 73_000_00;

  /** 53,000 + 2,000 leaves 18,000 unallocated — genuinely incomplete. */
  it('is invalid while a remainder is left over', () => {
    const result = validateSplit([part('groceries', 53_000_00), part('people', 2_000_00)], TOTAL);
    expect(result.valid).toBe(false);
    expect(result.remainderMinor).toBe(18_000_00);
  });

  it('becomes valid once the parts add up', () => {
    const result = validateSplit(
      [part('groceries', 53_000_00), part('people', 2_000_00), part('pocket', 18_000_00)],
      TOTAL,
    );
    expect(result.valid).toBe(true);
    expect(result.remainderMinor).toBe(0);
  });

  /** One part is not a split — it is the transaction with extra rows. */
  it('rejects a single part covering the whole amount', () => {
    expect(validateSplit([part('groceries', TOTAL)], TOTAL).valid).toBe(false);
  });

  it('rejects parts that overshoot the payment', () => {
    const result = validateSplit([part('a', 50_000_00), part('b', 30_000_00)], TOTAL);
    expect(result.valid).toBe(false);
    expect(result.remainderMinor).toBeLessThan(0);
  });
});
