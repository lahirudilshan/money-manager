import { describe, expect, it } from 'vitest';
import { CURRENCIES, defaultCurrencyForRegion, findCurrency } from '../currencies';

/**
 * Which currency a device's region implies.
 *
 * The rule under test: an unrecognised region returns null so the caller asks,
 * rather than defaulting and silently mislabelling every figure in the app.
 */

describe('region to currency', () => {
  it('maps Australia to AUD — the case this was built for', () => {
    expect(defaultCurrencyForRegion('AU')).toBe('AUD');
  });

  it('accepts a full locale tag in either separator style', () => {
    expect(defaultCurrencyForRegion('en-AU')).toBe('AUD');
    expect(defaultCurrencyForRegion('en_AU')).toBe('AUD');
    expect(defaultCurrencyForRegion('si-LK')).toBe('LKR');
  });

  it('is case-insensitive', () => {
    expect(defaultCurrencyForRegion('au')).toBe('AUD');
  });

  it('maps every euro-area region to EUR', () => {
    for (const region of ['DE', 'FR', 'IE', 'NL', 'PT']) {
      expect(defaultCurrencyForRegion(region)).toBe('EUR');
    }
  });

  it('returns null for an unrecognised region so the user is asked', () => {
    // Norway is real and unsupported: guessing would label kroner as dollars.
    expect(defaultCurrencyForRegion('NO')).toBeNull();
    expect(defaultCurrencyForRegion('ZZ')).toBeNull();
  });

  it('returns null for absent or malformed input', () => {
    expect(defaultCurrencyForRegion(null)).toBeNull();
    expect(defaultCurrencyForRegion(undefined)).toBeNull();
    expect(defaultCurrencyForRegion('')).toBeNull();
    expect(defaultCurrencyForRegion('  ')).toBeNull();
    expect(defaultCurrencyForRegion('ENGLISH')).toBeNull();
  });
});

describe('the offered list', () => {
  it('can display every currency a region can resolve to', () => {
    // Detection must never select something the picker cannot render.
    const regions = ['LK', 'US', 'GB', 'IN', 'AU', 'NZ', 'AE', 'SG', 'JP', 'CA', 'CH', 'MY', 'QA', 'SA', 'DE'];
    for (const region of regions) {
      const code = defaultCurrencyForRegion(region);
      expect(code, `no currency for ${region}`).not.toBeNull();
      expect(findCurrency(code!), `${code} missing from CURRENCIES`).toBeDefined();
    }
  });

  it('has no duplicate codes', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('looks up case-insensitively', () => {
    expect(findCurrency('aud')?.name).toBe('Australian Dollar');
    expect(findCurrency('nope')).toBeUndefined();
  });
});
