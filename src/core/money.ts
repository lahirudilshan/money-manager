/**
 * Money is represented as an integer number of minor units (cents).
 * Every arithmetic helper here returns integers, so a chain of operations can
 * never accumulate binary-floating-point error the way `0.1 + 0.2` does.
 */

export type Minor = number;

const MINOR_PER_MAJOR = 100;

/** Convert a major-unit amount (what a user types, e.g. 1500.50) to minor. */
export function toMinor(major: number): Minor {
  if (!Number.isFinite(major)) return 0;
  // Round away from binary representation error before truncating:
  // 19.99 * 100 is 1998.9999... in IEEE754, which would truncate to 1998.
  return Math.round(major * MINOR_PER_MAJOR);
}

/** Convert minor units back to a major-unit number for display or export. */
export function toMajor(minor: Minor): number {
  return minor / MINOR_PER_MAJOR;
}

/**
 * Parse free-form user input ("1,250.75", "LKR 1250", "1 250") into minor units.
 * Returns null when the input contains no parseable number, so callers can
 * distinguish "empty field" from "explicit zero".
 */
export function parseAmount(input: string): Minor | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return toMinor(value);
}

export interface FormatOptions {
  /** Currency code shown as a prefix. Defaults to LKR. */
  currency?: string;
  /** Hide the currency prefix entirely. */
  showCurrency?: boolean;
  /** Drop the decimal part — the default, since LKR amounts here are large. */
  showDecimals?: boolean;
  /** Render 1_200_000 as "1.2M" for tight spaces like chart axes. */
  compact?: boolean;
  /** Always show a leading + or -. */
  signed?: boolean;
}

/**
 * Format minor units for display. Grouping uses Intl so it stays correct
 * across locales rather than hand-rolling comma insertion.
 */
export function formatMoney(minor: Minor, options: FormatOptions = {}): string {
  const {
    currency = 'LKR',
    showCurrency = true,
    showDecimals = false,
    compact = false,
    signed = false,
  } = options;

  const major = toMajor(Math.abs(minor));
  const negative = minor < 0;

  let body: string;
  if (compact && major >= 1_000_000) {
    body = `${trimZeros((major / 1_000_000).toFixed(1))}M`;
  } else if (compact && major >= 1_000) {
    body = `${trimZeros((major / 1_000).toFixed(1))}K`;
  } else {
    body = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    }).format(major);
  }

  const sign = negative ? '-' : signed ? '+' : '';
  const prefix = showCurrency ? `${currency} ` : '';
  return `${sign}${prefix}${body}`;
}

function trimZeros(value: string): string {
  return value.replace(/\.0$/, '');
}

/** Sum minor amounts. Integer-safe by construction. */
export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Percentage of `part` relative to `total`, rounded to `decimals` places.
 * Returns 0 when total is 0 rather than NaN/Infinity, so the UI never has to
 * guard against a divide-by-zero when income is not yet entered.
 */
export function percentOf(part: Minor, total: Minor, decimals = 2): number {
  if (total === 0) return 0;
  const pct = (part / total) * 100;
  const factor = 10 ** decimals;
  return Math.round(pct * factor) / factor;
}

/** Convert a foreign-currency major amount into local minor units. */
export function convertToLocalMinor(foreignMajor: number, rate: number): Minor {
  return toMinor(foreignMajor * rate);
}
