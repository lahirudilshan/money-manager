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

/** Most digits allowed before the decimal point — 999,999,999,999.99. */
const MAX_INTEGER_DIGITS = 12;

/**
 * Reshape a money field as the user types.
 *
 * Called on every keystroke, so it must accept a HALF-TYPED value: "1", "1.",
 * and "1.5" are all legitimate intermediate states and none may be rewritten
 * into something that fights the person entering it. The rules are therefore
 * about removing what cannot be valid, never about completing what is unfinished:
 *
 *   - anything that is not a digit or a dot is dropped, which quietly handles a
 *     pasted "LKR 1,250.75" as well as a keyboard that offers a comma;
 *   - a second dot is ignored rather than accepted, since "1.2.3" is not a
 *     number and silently truncating it would change the amount;
 *   - decimals are capped at two, because minor units are cents and a third
 *     digit would be rounded away on save without the user seeing it;
 *   - the integer part gets thousands separators as it grows, so a large figure
 *     is readable while being typed rather than only after it is committed.
 *
 * A trailing dot SURVIVES. Stripping it would delete the point the instant it
 * was typed, making it impossible to enter a decimal at all.
 */
export function formatAmountInput(input: string): string {
  if (typeof input !== 'string') return '';

  /*
   * Drop a currency prefix BEFORE looking at dots.
   *
   * "Rs. 9 200" pasted from a bank message otherwise reads its "Rs." dot as the
   * decimal point and collapses to "0.92" — a hundredth of the real amount,
   * silently. Removing leading non-digits first means only dots that sit inside
   * the number itself are considered.
   */
  // A leading dot the user typed themselves is meaningful ("." starts "0.5"),
  // so it is preserved; anything else before the first digit is a prefix.
  const withoutPrefix = input.startsWith('.') ? input : input.replace(/^[^0-9]*/, '');

  // Keep digits and dots only; separators are re-inserted below from scratch,
  // so one the user typed never has to be reconciled with the ones this adds.
  const cleaned = withoutPrefix.replace(/[^0-9.]/g, '');
  if (cleaned === '') return '';

  const [rawInteger, ...rest] = cleaned.split('.');
  const hasDecimalPoint = rest.length > 0;

  // Everything after the FIRST dot, with any further dots removed — typing a
  // second point is a slip, and dropping it keeps the number the user sees.
  const decimals = rest.join('').slice(0, 2);

  // Trim leading zeros ("007" → "7") but keep one, so "0.5" survives and an
  // empty integer part before a dot reads as "0.".
  const integer = rawInteger.replace(/^0+(?=\d)/, '').slice(0, MAX_INTEGER_DIGITS) || '0';

  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (!hasDecimalPoint) return grouped;
  return `${grouped}.${decimals}`;
}

/**
 * Why an amount cannot be saved, or null when it is fine.
 *
 * Separate from `formatAmountInput` because the two run at different moments:
 * formatting happens on every keystroke and must tolerate half-typed input,
 * while validation is asked at the point of saving, where "1." is genuinely
 * incomplete. Returns a sentence for the user rather than a code, since every
 * caller shows it verbatim.
 */
export function validateAmount(input: string): string | null {
  const minor = parseAmount(input);

  if (minor === null) return 'Enter an amount';
  if (minor <= 0) return 'Amount must be more than zero';

  const digits = input.replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (digits.length > MAX_INTEGER_DIGITS + 2) return 'That amount is too large';

  return null;
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
