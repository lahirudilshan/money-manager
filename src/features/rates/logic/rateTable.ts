/**
 * Exchange rates for ANY currency pair, not just USD.
 *
 * ## The problem this replaces
 *
 * The app stored exactly one number, `usd_rate`, meaning "home currency per 1
 * USD". That is enough for a Sri Lankan user holding dollars and nothing else.
 * It fails the moment the home currency is not LKR or the foreign one is not
 * USD: an Australian with a EUR account had that balance passed through
 * UNCONVERTED — EUR 500 landing in an AUD total as 500 — because there was no
 * rate to convert by and inventing one would be worse.
 *
 * ## The shape
 *
 * Rates are stored against a single PIVOT currency (USD by convention), one
 * number per code: "how many USD is 1 unit of this worth". Any pair is then a
 * division through the pivot, so N currencies need N rates rather than N².
 *
 * The pivot is an implementation detail, never a home currency. A user in
 * Australia holding EUR converts EUR→USD→AUD without USD appearing anywhere on
 * their screen.
 *
 * ## What it refuses to do
 *
 * Every function returns null rather than guessing when a rate is missing. That
 * is the whole discipline inherited from the code this replaces: a confidently
 * wrong number is worse than a visibly absent one, because the user cannot see
 * that a total is off by a factor of 300. Callers surface the gap (see
 * `missingRates`) instead of quietly under-reporting.
 */

import { toMinor, toMajor, type Minor } from '~/shared/lib/money';

/**
 * The currency every stored rate is quoted against.
 *
 * USD because that is what public FX sources quote, and because it is what the
 * app already stored — the migration from `usd_rate` is then exact rather than
 * approximate for existing users.
 */
export const PIVOT_CURRENCY = 'USD';

/**
 * Rates as `{ CODE: value }`, where value is CODE's worth in the pivot.
 *
 * So `{ LKR: 0.0033, EUR: 1.08 }` reads "1 LKR is 0.0033 USD, 1 EUR is 1.08
 * USD". The pivot itself is always exactly 1 and is not required to be present.
 */
export type RateTable = Readonly<Record<string, number>>;

/** Whether a stored figure can actually be used as a rate. */
function usable(rate: number | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** A code in the one canonical shape, so lookups cannot miss on case alone. */
export function normaliseCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * One unit of `code` expressed in the pivot currency.
 *
 * The pivot is 1 by definition and needs no stored row, which also means a
 * user whose home currency IS the pivot never depends on a fetch to see their
 * own money correctly.
 */
export function pivotValue(table: RateTable, code: string): number | null {
  const normalised = normaliseCode(code);
  if (!normalised) return null;
  if (normalised === PIVOT_CURRENCY) return 1;

  const rate = table[normalised];
  return usable(rate) ? rate : null;
}

/**
 * How many units of `to` one unit of `from` buys, or null when unknown.
 *
 * Identity is short-circuited before any lookup so converting a currency to
 * itself works on a completely empty table — the offline first-launch case,
 * where every figure is in the home currency and no rate has been fetched yet.
 */
export function rateBetween(table: RateTable, from: string, to: string): number | null {
  const source = normaliseCode(from);
  const target = normaliseCode(to);
  if (!source || !target) return null;
  if (source === target) return 1;

  const sourceInPivot = pivotValue(table, source);
  const targetInPivot = pivotValue(table, target);
  if (sourceInPivot === null || targetInPivot === null) return null;

  return sourceInPivot / targetInPivot;
}

/**
 * Convert minor units between two currencies, or null when no rate exists.
 *
 * Minor units are assumed to be hundredths on both sides, which is what the
 * rest of the app assumes (`MINOR_PER_MAJOR = 100`). Currencies with other
 * exponents — JPY has none — would need that generalised first; they are not
 * silently mishandled here because the conversion goes through major units.
 */
export function convertMinor(
  amountMinor: Minor,
  from: string,
  to: string,
  table: RateTable,
): Minor | null {
  const rate = rateBetween(table, from, to);
  if (rate === null) return null;
  if (rate === 1) return amountMinor;

  return toMinor(toMajor(amountMinor) * rate);
}

/**
 * The codes among `needed` that cannot be converted into `home`.
 *
 * Returned as a sorted, de-duplicated list so the UI can name exactly what is
 * missing ("no rate for EUR") instead of showing a total that quietly excludes
 * it. Sorted for a stable render — an unsorted set reorders between refreshes
 * and makes the caption flicker.
 */
export function missingRates(
  table: RateTable,
  home: string,
  needed: readonly string[],
): string[] {
  const missing = new Set<string>();
  for (const code of needed) {
    const normalised = normaliseCode(code);
    if (!normalised) continue;
    if (rateBetween(table, normalised, home) === null) missing.add(normalised);
  }
  return [...missing].sort();
}

/**
 * Fold the legacy `usd_rate` scalar into a table.
 *
 * The old number meant "home currency per 1 USD", which is the inverse of what
 * the table stores for the home code — so this is a reciprocal, not a copy.
 * Getting that backwards would leave every existing user's converted figures
 * wrong by the square of the rate, which is exactly the silent corruption this
 * module exists to prevent.
 *
 * An explicit entry already in the table WINS: a rate that was actually fetched
 * is better than one reconstructed from a setting the user may have typed by
 * hand months ago.
 */
export function withLegacyUsdRate(
  table: RateTable,
  homeCurrency: string,
  usdRate: number,
): RateTable {
  const home = normaliseCode(homeCurrency);
  if (!home || home === PIVOT_CURRENCY) return table;
  if (!usable(usdRate)) return table;
  if (usable(table[home])) return table;

  return { ...table, [home]: 1 / usdRate };
}

/**
 * Parse a stored rate table, tolerating anything that is not one.
 *
 * Settings hold strings, and this one is JSON written by a previous version of
 * the app. Corrupt or half-written content must degrade to "no rates" — which
 * shows figures unconverted and flagged — rather than throwing during store
 * hydration and taking the whole app down over a display detail.
 *
 * Non-numeric and non-positive entries are dropped individually, so one bad
 * value cannot discard the rates either side of it.
 */
export function parseRateTable(stored: string | null | undefined): RateTable {
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const table: Record<string, number> = {};
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalised = normaliseCode(code);
      if (normalised && usable(value as number)) table[normalised] = value as number;
    }
    return table;
  } catch {
    return {};
  }
}

/** Serialise for the settings store. */
export function serialiseRateTable(table: RateTable): string {
  return JSON.stringify(table);
}
