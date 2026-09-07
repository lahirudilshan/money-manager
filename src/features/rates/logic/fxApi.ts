/**
 * Fetching mid-market rates for ANY currency, so a board outside Sri Lanka works.
 *
 * ## Why this exists alongside bankRatesApi
 *
 * `bankRatesApi` scrapes SRI LANKAN banks. It is the better source for a user
 * here — a real TT buying rate beats mid-market when you are actually selling
 * dollars to a named bank — but it has nothing to say to someone in Australia
 * holding euros. Without this, every foreign account on a non-LKR board is
 * flagged "no rate" forever, which is where the multi-currency work stopped.
 *
 * So: this fills `rateTable`, the general store; bank rates stay the specialist
 * view for LKR users. They do not compete, because they answer different
 * questions.
 *
 * ## The source
 *
 * `open.er-api.com` is free, key-less, and updates daily. Like the bank feed it
 * is a third party with no SLA, so the same discipline applies throughout:
 * every failure path returns null rather than throwing, the parser accepts only
 * what it can actually read, and a failed refresh leaves the last good table in
 * place. The app degrades to exactly what it did before — figures unconverted
 * and visibly flagged, never silently wrong.
 */

import {
  PIVOT_CURRENCY,
  normaliseCode,
  parseRateTable,
  serialiseRateTable,
  type RateTable,
} from './rateTable';

/**
 * Quoted against the pivot, which is what the table stores.
 *
 * The endpoint returns "how many X per 1 USD" — the INVERSE of what a table
 * entry means ("1 X is worth this many USD"), so `parseFxPayload` reciprocates.
 * Getting that backwards is the same squared-error trap as the legacy scalar.
 */
const BASE_URL = `https://open.er-api.com/v6/latest/${PIVOT_CURRENCY}`;

/** Unattended at launch, so it can afford to be patient — but not forever. */
const TIMEOUT_MS = 12_000;

/** Refresh cadence. Mid-market rates move slowly; daily is ample. */
const REFRESH_MS = 24 * 60 * 60 * 1000;

/** A usable positive rate, or null for anything else. */
function toRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Turn the API's payload into a table this app can trust.
 *
 * Exported for tests: the parsing is the part most likely to break when the
 * upstream shape drifts, and it can be exercised against captured payloads with
 * no network.
 *
 * Two conversions happen here, and both matter:
 *
 *   - the quote is INVERTED. The feed says "302.5 LKR per USD"; the table wants
 *     "1 LKR is 1/302.5 USD". Copying the figure straight through would leave
 *     every converted amount wrong by the square of the rate.
 *   - unusable entries are dropped INDIVIDUALLY, so one bad row cannot discard
 *     the currencies either side of it.
 *
 * Returns an empty table rather than throwing on anything unrecognisable.
 */
export function parseFxPayload(payload: unknown): RateTable {
  if (!payload || typeof payload !== 'object') return {};

  const body = payload as { result?: unknown; rates?: unknown; base_code?: unknown };

  // The feed states success explicitly; an error payload also carries `rates`
  // in some shapes, so trusting the presence of that field alone is not enough.
  if (typeof body.result === 'string' && body.result !== 'success') return {};

  // A payload quoted against something other than the pivot would invert into
  // silently wrong numbers, so it is refused rather than reinterpreted.
  if (typeof body.base_code === 'string' && normaliseCode(body.base_code) !== PIVOT_CURRENCY) {
    return {};
  }

  const rates = body.rates;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return {};

  const table: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates as Record<string, unknown>)) {
    const normalised = normaliseCode(code);
    if (!normalised || normalised === PIVOT_CURRENCY) continue;

    const perPivot = toRate(value);
    if (perPivot === null) continue;

    table[normalised] = 1 / perPivot;
  }

  return table;
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
 * Every mid-market rate, or null on any failure.
 *
 * Null rather than a throw because every caller's answer to a failure is the
 * same — keep the last known table and say nothing — and an exception would
 * make each of them write that out again.
 */
export async function fetchFxRates(): Promise<RateTable | null> {
  try {
    const response = await fetchWithTimeout(BASE_URL);
    if (!response.ok) return null;

    const table = parseFxPayload(await response.json());
    // An empty table from a 200 is not worth overwriting good cached data with,
    // so it reads as a failure to the caller.
    return Object.keys(table).length > 0 ? table : null;
  } catch {
    return null;
  }
}

/** Whether a refresh is due. An unparseable stamp reads as "never fetched". */
export function isFxFetchDue(lastFetchedAt: string | null | undefined, now = new Date()): boolean {
  if (!lastFetchedAt) return true;

  const last = Date.parse(lastFetchedAt);
  if (!Number.isFinite(last)) return true;

  return now.getTime() - last >= REFRESH_MS;
}

/**
 * Refresh the stored rate table, at most once a day.
 *
 * Never throws and never blocks: `fetchFxRates` swallows every failure, and a
 * refresh that finds nothing leaves the last good table in place. A caller can
 * `void` this and forget about it.
 *
 * The fetched table is MERGED over the stored one rather than replacing it. A
 * feed that briefly stops quoting a currency would otherwise silently drop it,
 * turning a working account into an unconvertible one — keeping the older rate
 * is better than having none, and the timestamp still says how fresh it is.
 *
 * Returns the table now in the cache, so a screen can adopt it directly rather
 * than reading back what it just wrote.
 */
export async function refreshFxRates(options: {
  get: (key: string) => string | null | undefined;
  set: (key: string, value: string) => void;
  keyRates: string;
  keyFetchedAt: string;
  /** Skip the daily guard — the user explicitly asked for fresh figures. */
  force?: boolean;
  now?: Date;
}): Promise<RateTable | null> {
  const { get, set, keyRates, keyFetchedAt, force = false, now = new Date() } = options;

  if (!force && !isFxFetchDue(get(keyFetchedAt), now)) return null;

  const fetched = await fetchFxRates();
  if (!fetched) return null;

  const merged = { ...parseRateTable(get(keyRates)), ...fetched };
  set(keyRates, serialiseRateTable(merged));
  set(keyFetchedAt, now.toISOString());
  return merged;
}
