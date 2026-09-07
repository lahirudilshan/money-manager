import { describe, expect, it } from 'vitest';
import {
  PIVOT_CURRENCY,
  convertMinor,
  missingRates,
  normaliseCode,
  pivotValue,
  rateBetween,
  withLegacyUsdRate,
  type RateTable,
} from '../rateTable';

/**
 * Rates for any pair, and the refusals that keep a wrong figure off the screen.
 *
 * The rule under test throughout: a missing rate produces null, never a guess.
 * The bug this module replaces was the opposite — a EUR balance passed through
 * unconverted into an AUD total, indistinguishable from a real number.
 */

/** 1 unit of each code, in USD. Roughly real, so the maths reads honestly. */
const TABLE: RateTable = {
  LKR: 0.0033,
  AUD: 0.66,
  EUR: 1.08,
  GBP: 1.27,
};

describe('pivot lookups', () => {
  it('treats the pivot as exactly 1 without needing a stored row', () => {
    // A user whose home currency IS the pivot must not depend on a fetch.
    expect(pivotValue({}, PIVOT_CURRENCY)).toBe(1);
  });

  it('reads a stored rate', () => {
    expect(pivotValue(TABLE, 'EUR')).toBe(1.08);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(pivotValue(TABLE, ' eur ')).toBe(1.08);
    expect(normaliseCode(' aud ')).toBe('AUD');
  });

  it('returns null for an unknown or unusable code', () => {
    expect(pivotValue(TABLE, 'JPY')).toBeNull();
    expect(pivotValue({ EUR: 0 }, 'EUR')).toBeNull();
    expect(pivotValue({ EUR: Number.NaN }, 'EUR')).toBeNull();
    expect(pivotValue(TABLE, '')).toBeNull();
  });
});

describe('rates between arbitrary pairs', () => {
  it('converts a pair that does not involve the pivot at all', () => {
    // The whole point: an Australian holding EUR never sees USD on screen.
    const rate = rateBetween(TABLE, 'EUR', 'AUD');
    expect(rate).toBeCloseTo(1.08 / 0.66, 10);
  });

  it('is symmetric — one direction is the other inverted', () => {
    const there = rateBetween(TABLE, 'EUR', 'AUD')!;
    const back = rateBetween(TABLE, 'AUD', 'EUR')!;
    expect(there * back).toBeCloseTo(1, 10);
  });

  it('returns 1 for a currency against itself, even on an empty table', () => {
    // First launch, offline, nothing fetched: home-currency figures must work.
    expect(rateBetween({}, 'AUD', 'AUD')).toBe(1);
  });

  it('returns null when either side has no rate', () => {
    expect(rateBetween(TABLE, 'JPY', 'AUD')).toBeNull();
    expect(rateBetween(TABLE, 'AUD', 'JPY')).toBeNull();
  });
});

describe('converting money', () => {
  it('leaves an amount alone when the currencies match', () => {
    expect(convertMinor(50_000, 'AUD', 'AUD', {})).toBe(50_000);
  });

  it('converts through the pivot', () => {
    // EUR 500.00 -> AUD at 1.08/0.66 = 818.18...
    const result = convertMinor(500_00, 'EUR', 'AUD', TABLE);
    expect(result).toBe(Math.round(500 * (1.08 / 0.66) * 100));
  });

  it('round-trips within a cent', () => {
    const there = convertMinor(1_234_56, 'AUD', 'EUR', TABLE)!;
    const back = convertMinor(there, 'EUR', 'AUD', TABLE)!;
    expect(Math.abs(back - 1_234_56)).toBeLessThanOrEqual(1);
  });

  it('returns null rather than the raw figure when no rate exists', () => {
    // The exact bug being fixed: this used to return 50_000 unchanged, which a
    // total then added to AUD as though it were AUD.
    expect(convertMinor(50_000, 'JPY', 'AUD', TABLE)).toBeNull();
  });
});

describe('naming what cannot be converted', () => {
  it('lists only the codes with no path to home', () => {
    expect(missingRates(TABLE, 'AUD', ['EUR', 'JPY', 'GBP'])).toEqual(['JPY']);
  });

  it('never reports the home currency as missing', () => {
    expect(missingRates({}, 'AUD', ['AUD'])).toEqual([]);
  });

  it('de-duplicates and sorts, so the caption is stable across refreshes', () => {
    expect(missingRates(TABLE, 'AUD', ['JPY', 'CHF', 'JPY'])).toEqual(['CHF', 'JPY']);
  });
});

describe('migrating the legacy usd_rate', () => {
  it('stores the RECIPROCAL, because the old scalar was home-per-USD', () => {
    // usd_rate 300 meant "300 LKR per USD", so 1 LKR is 1/300 USD. Copying the
    // 300 straight in would leave every figure wrong by 300 squared.
    const table = withLegacyUsdRate({}, 'LKR', 300);
    expect(table.LKR).toBeCloseTo(1 / 300, 12);
  });

  it('makes an existing LKR balance convert to the same figure as before', () => {
    // The migration must be exact for current users, not merely close.
    const table = withLegacyUsdRate({}, 'LKR', 300);
    // USD 10.00 at 300 was LKR 3,000.00 under the old scalar.
    expect(convertMinor(10_00, 'USD', 'LKR', table)).toBe(3_000_00);
  });

  it('does not overwrite a rate that was actually fetched', () => {
    const table = withLegacyUsdRate({ LKR: 0.0033 }, 'LKR', 300);
    expect(table.LKR).toBe(0.0033);
  });

  it('ignores a home currency that is already the pivot', () => {
    expect(withLegacyUsdRate({}, 'USD', 300)).toEqual({});
  });

  it('ignores an unusable legacy rate instead of poisoning the table', () => {
    expect(withLegacyUsdRate({}, 'LKR', 0)).toEqual({});
    expect(withLegacyUsdRate({}, 'LKR', Number.NaN)).toEqual({});
  });
});
