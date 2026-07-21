import { describe, expect, it } from 'vitest';
import {
  convertToLocalMinor,
  formatMoney,
  parseAmount,
  percentOf,
  sumMinor,
  toMajor,
  toMinor,
} from '../money';

describe('toMinor', () => {
  it('converts whole units', () => {
    expect(toMinor(1500)).toBe(150_000);
  });

  it('converts fractional units without floating point drift', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE754 — truncation would give 1998.
    expect(toMinor(19.99)).toBe(1999);
  });

  it('handles zero and negatives', () => {
    expect(toMinor(0)).toBe(0);
    expect(toMinor(-45.5)).toBe(-4550);
  });

  it('returns zero for non-finite input', () => {
    expect(toMinor(Number.NaN)).toBe(0);
    expect(toMinor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('toMajor', () => {
  it('round-trips with toMinor', () => {
    expect(toMajor(toMinor(1234.56))).toBe(1234.56);
  });
});

describe('parseAmount', () => {
  it('parses a plain number', () => {
    expect(parseAmount('1500')).toBe(150_000);
  });

  it('strips grouping separators', () => {
    expect(parseAmount('1,250.75')).toBe(125_075);
  });

  it('strips a currency prefix', () => {
    expect(parseAmount('LKR 750,000')).toBe(75_000_000);
  });

  it('returns null for empty or non-numeric input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('.')).toBeNull();
  });

  it('distinguishes explicit zero from empty', () => {
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats with currency and grouping by default', () => {
    expect(formatMoney(75_000_000)).toBe('LKR 750,000');
  });

  it('omits the currency when asked', () => {
    expect(formatMoney(75_000_000, { showCurrency: false })).toBe('750,000');
  });

  it('shows decimals when asked', () => {
    expect(formatMoney(125_075, { showDecimals: true })).toBe('LKR 1,250.75');
  });

  it('places the sign before the currency for negatives', () => {
    expect(formatMoney(-23_600_000)).toBe('-LKR 236,000');
  });

  it('adds an explicit plus when signed', () => {
    expect(formatMoney(5000, { signed: true })).toBe('+LKR 50');
  });

  it('compacts millions and thousands', () => {
    expect(formatMoney(1_355_000_000, { compact: true })).toBe('LKR 13.6M');
    expect(formatMoney(15_000_000, { compact: true })).toBe('LKR 150K');
  });

  it('trims a trailing .0 in compact form', () => {
    expect(formatMoney(200_000_000, { compact: true })).toBe('LKR 2M');
  });
});

describe('sumMinor', () => {
  it('sums without floating point error', () => {
    // The classic 0.1 + 0.2 problem, in cents.
    expect(sumMinor([10, 20])).toBe(30);
  });

  it('returns zero for an empty list', () => {
    expect(sumMinor([])).toBe(0);
  });

  it('sums the spreadsheet expense list exactly', () => {
    const expenses = [
      50_000, 2_000, 15_000, 10_000, 8_000, 2_000, 10_000, 3_000, 35_000, 10_000,
      36_000, 15_000, 10_000, 10_000, 20_000,
    ].map(toMinor);
    expect(sumMinor(expenses)).toBe(toMinor(236_000));
  });
});

describe('percentOf', () => {
  it('computes a simple percentage', () => {
    expect(percentOf(2500, 10_000)).toBe(25);
  });

  it('matches the spreadsheet loan ratio', () => {
    // 281,213 of 750,000 income -> 37.50%
    expect(percentOf(toMinor(281_213), toMinor(750_000))).toBeCloseTo(37.5, 1);
  });

  it('returns zero rather than NaN when the total is zero', () => {
    expect(percentOf(1000, 0)).toBe(0);
  });

  it('respects the decimals argument', () => {
    expect(percentOf(1, 3, 2)).toBe(33.33);
    expect(percentOf(1, 3, 0)).toBe(33);
  });
});

describe('convertToLocalMinor', () => {
  it('converts a USD salary at the stored rate', () => {
    // 2,500 USD at 300 LKR -> 750,000 LKR
    expect(convertToLocalMinor(2500, 300)).toBe(toMinor(750_000));
  });
});
