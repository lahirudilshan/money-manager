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

/**
 * The currency code every unqualified `formatMoney` call renders.
 *
 * Formatting happens in ~100 call sites, almost none of which have any reason
 * to know about app settings — threading the user's choice through all of them
 * (and through the pure summary helpers they sit inside) would be far more
 * invasive than the preference deserves. Instead the store publishes the
 * setting here whenever it loads or changes, and `formatMoney` reads it.
 *
 * Module-level state is a deliberate trade: this is a single display preference
 * with one writer (`setDisplayCurrency`, called only from the store), and it is
 * read synchronously during render, so there is no ordering hazard. Anything
 * needing an explicit currency still passes `options.currency`.
 */
let displayCurrency = 'LKR';

/** Point every unqualified `formatMoney` at this currency code. */
export function setDisplayCurrency(code: string): void {
  if (typeof code === 'string' && code.trim()) displayCurrency = code.trim();
}

/** The code `formatMoney` currently defaults to. Exposed for tests. */
export function getDisplayCurrency(): string {
  return displayCurrency;
}

export interface FormatOptions {
  /** Currency code shown as a prefix. Defaults to the user's chosen currency. */
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
    currency = displayCurrency,
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

  // The sign belongs to the number, not to the currency code: "LKR -45,000",
  // never "-LKR 45,000". This shows up on the dashboard whenever disposable
  // income goes negative, which is precisely when the figure must read cleanly.
  const sign = negative ? '-' : signed ? '+' : '';
  const prefix = showCurrency ? `${currency} ` : '';
  return `${prefix}${sign}${body}`;
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
