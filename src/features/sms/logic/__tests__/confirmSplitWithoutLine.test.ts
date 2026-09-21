import { describe, expect, it } from 'vitest';

/**
 * The screen and the store must agree on what a split needs.
 *
 * ## The bug
 *
 * `confirmDraft` opened with `if (!subcategoryId) return;` — an unconditional
 * demand for a single destination line. The review screen had already stopped
 * requiring one once a split was open (`canLog`), because the PARTS are the
 * destination. The two disagreed, and the disagreement was silent: the button
 * enabled, `logIt` ran, `closeModal()` fired, and the store returned without
 * writing anything. The draft was still `pending`, so it reappeared under
 * Smart detect — the user's exact report, "modal close but it not save".
 *
 * It only bit a merchant with NO learned rule, because then the parser
 * suggests no line and `subcategoryId` is `''`. Splitting a recognised shop
 * worked, which is what made it look intermittent. Confirmed on the device:
 * "SANDALIYA PLANT NURSERY" had no row in `merchant_rules`.
 *
 * ## What is pinned here
 *
 * The store cannot run under node (expo-sqlite), so these model the two
 * predicates and assert they never disagree — the invariant whose violation
 * WAS the bug.
 */

interface Part {
  subcategoryId: string;
  amountMinor: number;
}

/** `canLog` on the review screen: what enables the "Log it" button. */
function canLog(args: {
  splitting: boolean;
  subcategoryId: string;
  amountMinor: number;
  splitValid: boolean;
}): boolean {
  return args.splitting
    ? args.amountMinor > 0 && args.splitValid
    : args.subcategoryId !== '' && args.amountMinor > 0;
}

/** `confirmDraft`'s guard: whether the store will actually write. */
function willWrite(args: { subcategoryId: string; splits: Part[] | null }): boolean {
  const splits = args.splits && args.splits.length > 0 ? args.splits : null;
  let subcategoryId = args.subcategoryId;
  if (!subcategoryId && splits) subcategoryId = splits[0].subcategoryId;
  return Boolean(subcategoryId);
}

const PARTS: Part[] = [
  { subcategoryId: 'plan_sub_dining', amountMinor: 80000 },
  { subcategoryId: 'plan_sub_groceries', amountMinor: 130000 },
];

describe('confirming a split for an unrecognised merchant', () => {
  /* The exact failing case, with the device's own numbers. */
  it('writes even though the parser suggested no line', () => {
    expect(willWrite({ subcategoryId: '', splits: PARTS })).toBe(true);
  });

  it('files the parent transaction against the first part', () => {
    const splits = PARTS;
    let subcategoryId = '';
    if (!subcategoryId && splits.length > 0) subcategoryId = splits[0].subcategoryId;
    expect(subcategoryId).toBe('plan_sub_dining');
  });

  /*
   * The invariant. Every state the screen will let the user act on must be one
   * the store will actually write — otherwise the sheet closes on a no-op and
   * the work is lost with no error anywhere.
   */
  it('never enables a button the store would ignore', () => {
    const cases = [
      { splitting: true, subcategoryId: '', splitValid: true, splits: PARTS },
      { splitting: true, subcategoryId: 'x', splitValid: true, splits: PARTS },
      { splitting: false, subcategoryId: 'x', splitValid: false, splits: null },
    ];

    for (const c of cases) {
      const enabled = canLog({ ...c, amountMinor: 210000 });
      if (enabled) {
        expect(
          willWrite({ subcategoryId: c.subcategoryId, splits: c.splits }),
        ).toBe(true);
      }
    }
  });

  /* Still nothing to write when there is neither a line nor any parts. */
  it('refuses a draft with no line and no split', () => {
    expect(willWrite({ subcategoryId: '', splits: null })).toBe(false);
    expect(willWrite({ subcategoryId: '', splits: [] })).toBe(false);
  });

  it('keeps an explicitly chosen line over the first part', () => {
    const splits = PARTS;
    const chosen = 'plan_sub_transport';
    let subcategoryId = chosen;
    if (!subcategoryId && splits.length > 0) subcategoryId = splits[0].subcategoryId;
    expect(subcategoryId).toBe(chosen);
  });
});
