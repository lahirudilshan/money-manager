/**
 * Fetching per-bank rates.
 *
 * Kept apart from `bankRates.ts` so the parsing and policy there stay pure and
 * testable without a network; this file is the only part that talks to anyone.
 *
 * ## The source
 *
 * `api.ratesdigest.com` is the backend of ratesdigest.com, which scrapes each
 * Sri Lankan bank's own published rates page and normalises them into one
 * feed. It is public and key-less, but it is also UNDOCUMENTED and carries no
 * SLA — it can change shape or disappear without notice.
 *
 * Everything here is written on that assumption. Every failure path returns
 * null rather than throwing, `parseRates` accepts only rows it can actually
 * read and silently drops the rest, and the caller keeps the mid-market rate
 * and the user's own manual figure as fallbacks. The feature degrades to
 * exactly what the app did before it existed.
 */

import type { BankRate } from './bankRates';

const BASE_URL = 'https://api.ratesdigest.com/v1';

/**
 * Short, because this runs while a screen is open and waiting on it.
 *
 * The mid-market fetch can afford to be patient — it runs unattended at launch
 * — but a user looking at the rates screen should get an error state quickly
 * rather than an indefinite spinner.
 */
const TIMEOUT_MS = 12_000;

/** One row as the API sends it. Every field is optional: it is not our schema. */
interface RawRate {
  bank_name?: unknown;
  tt_buying?: unknown;
  tt_selling?: unknown;
  timestamp?: unknown;
}

/** A number, or null for anything that is not a usable positive rate. */
function toRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Turn whatever the API returned into rows this app can trust.
 *
 * Exported for tests, which is the point: the parsing is the part most likely
 * to break when the upstream shape drifts, and it can be exercised against
 * captured payloads without a network.
 *
 * A row with no bank name is dropped entirely — it cannot be matched to a bank
 * or labelled, so it has nothing to contribute. A row with a name but no TT
 * buying rate is KEPT with a null, because "this bank publishes no TT rate" is
 * information worth rendering.
 */
export function parseRates(payload: unknown): BankRate[] {
  if (!Array.isArray(payload)) return [];

  const rates: BankRate[] = [];

  for (const row of payload as RawRate[]) {
    if (row === null || typeof row !== 'object') continue;

    const bankName = typeof row.bank_name === 'string' ? row.bank_name.trim() : '';
    if (!bankName) continue;

    // Milliseconds since epoch upstream. A missing or unusable stamp falls back
    // to "now" rather than dropping the row: the rate is still the rate, and
    // the timestamp only drives a "last updated" caption.
    const ms = typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
      ? row.timestamp
      : Date.now();

    rates.push({
      bankName,
      ttBuying: toRate(row.tt_buying),
      ttSelling: toRate(row.tt_selling),
      at: new Date(ms).toISOString(),
    });
  }

  return rates;
}

/** fetch with a timeout — RN's fetch has no native support for one. */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every bank's rates for one currency, or null on any failure.
 *
 * Null rather than a throw because every caller's answer to a failure is the
 * same — keep showing the last known rates and say so — and an exception would
 * make each of them write that out again.
 */
export async function fetchBankRates(currency: string): Promise<BankRate[] | null> {
  try {
    const url = `${BASE_URL}/exchange-rates?currency=${encodeURIComponent(currency)}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const parsed = parseRates(await response.json());
    // An empty array from a 200 means the source has no rates for this
    // currency — a real answer, but not one worth overwriting good cached data
    // with, so it reads as a failure to the caller.
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Refresh the cached per-bank rates, at most once a day.
 *
 * The shared entry point for both callers — the launch hook and the rates
 * screen's pull-to-refresh — so the cache format and the daily cadence are
 * decided in exactly one place.
 *
 * Never throws and never blocks anything: `fetchBankRates` already swallows
 * every failure, and a refresh that finds nothing simply leaves the last good
 * rates in place. A caller can `void` this and forget about it.
 *
 * Returns the rows now in the cache, so the screen can adopt them directly
 * rather than reading back what it just wrote.
 */
export async function refreshBankRates(options: {
  get: (key: string) => string | null | undefined;
  set: (key: string, value: string) => void;
  keyRates: string;
  keyFetchedAt: string;
  /**
   * Which currency to fetch. Defaults to USD, which is what almost every
   * foreign account here holds — but a EUR or GBP account needs its own rates,
   * and the source carries all of them.
   */
  currency?: string;
  /** Skip the daily guard — the user explicitly asked for fresh figures. */
  force?: boolean;
  now?: Date;
}): Promise<BankRate[] | null> {
  const {
    get,
    set,
    keyRates,
    keyFetchedAt,
    currency = 'USD',
    force = false,
    now = new Date(),
  } = options;

  if (!force && !isBankFetchDue(get(keyFetchedAt), now)) return null;

  const fetched = await fetchBankRates(currency);
  if (!fetched) return null;

  set(keyRates, JSON.stringify(fetched));
  set(keyFetchedAt, now.toISOString());
  return fetched;
}

/**
 * Whether a per-bank refresh is due.
 *
 * Its own function rather than reusing the mid-market `isFetchDue`, because
 * the two caches have separate timestamps and tying them together would mean
 * one silently suppressing the other's refresh.
 *
 * A missing or unparseable stamp reads as "never fetched", so the first launch
 * after an update fetches immediately.
 */
export function isBankFetchDue(lastFetchedAt: string | null | undefined, now = new Date()): boolean {
  if (!lastFetchedAt) return true;

  const last = Date.parse(lastFetchedAt);
  if (!Number.isFinite(last)) return true;

  return now.getTime() - last >= 24 * 60 * 60 * 1000;
}

/** Read the cached rows, tolerating anything that is not what we wrote. */
export function readCachedRates(stored: string | null | undefined): BankRate[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as BankRate[]) : [];
  } catch {
    return [];
  }
}
