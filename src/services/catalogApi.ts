/**
 * HTTP client for the shared merchant catalog.
 *
 * The app talks to a small API, never to Postgres directly. A connection string
 * inside the bundle is extractable from any installed build, and the catalog
 * role can write — so one leaked APK would let a stranger rewrite the hints
 * every user receives. `EXPO_PUBLIC_HINTS_API` holds only a public base URL,
 * which is safe to ship precisely because it grants nothing on its own.
 *
 * Two calls, both background-only: pull the catalog into SQLite, and push this
 * device's corrections back. DETECTION NEVER CALLS THE NETWORK — it reads the
 * mirrored catalog locally, because an SMS arrives at a fuel pump or a
 * supermarket queue, which is where signal is worst.
 *
 * Every failure here is therefore non-fatal by construction: with no network, a
 * bad response, or no API configured at all, SMS intake works exactly as it
 * does online, just without merchants the crowd has learned since the last sync.
 */

import type { Observation, SharedRule } from '../core/catalogSync';

/**
 * Base URL of the deployed API, injected at build time.
 *
 * Unset means the feature is simply off — the calls below return empty results
 * and the store skips the sync, so a fresh clone runs with no backend.
 */
const BASE_URL = process.env.EXPO_PUBLIC_HINTS_API?.replace(/\/+$/, '') ?? '';

/**
 * Sync and contribution both run unattended in the background, so the timeout
 * only needs to stop a stalled socket holding a promise open — nothing is
 * waiting on either.
 */
const SYNC_TIMEOUT_MS = 10_000;

export function isCatalogConfigured(): boolean {
  return BASE_URL.length > 0;
}

/** fetch with a timeout, since RN's fetch has no native support for one. */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface PullResult {
  rules: SharedRule[];
  /** Cursor to persist and send on the next pull. Null when nothing moved. */
  nextSince: string | null;
  hasMore: boolean;
}

const EMPTY_PULL: PullResult = { rules: [], nextSince: null, hasMore: false };

/**
 * Fetch catalog rows changed since `since`.
 *
 * This is the ONLY read the app makes. Detection itself never touches the
 * network — the catalog is mirrored into SQLite here and every subsequent
 * message is categorised on-device.
 *
 * Returns an empty result rather than throwing on any failure: this runs
 * unattended at launch, and a network blip must not surface as an error to
 * someone who never asked for a sync.
 */
export async function pullRules(since: string | null): Promise<PullResult> {
  if (!isCatalogConfigured()) return EMPTY_PULL;

  try {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await fetchWithTimeout(`${BASE_URL}/api/hints${query}`, SYNC_TIMEOUT_MS);
    if (!response.ok) return EMPTY_PULL;

    const body = (await response.json()) as Partial<PullResult>;
    if (!Array.isArray(body.rules)) return EMPTY_PULL;

    // Validate every row: this data becomes detection logic on the device, so a
    // malformed or hostile response must not write junk patterns into the local
    // rules table.
    const rules = body.rules.filter(
      (rule): rule is SharedRule =>
        !!rule &&
        typeof rule.merchant === 'string' &&
        rule.merchant.length > 0 &&
        typeof rule.hint === 'string' &&
        typeof rule.votes === 'number' &&
        typeof rule.margin === 'number' &&
        (rule.source === 'seed' || rule.source === 'learned'),
    );

    return {
      rules,
      nextSince: typeof body.nextSince === 'string' ? body.nextSince : null,
      hasMore: body.hasMore === true,
    };
  } catch {
    return EMPTY_PULL;
  }
}

/**
 * Send this device's observations to the catalog.
 *
 * Resolves to the number accepted, or 0 on any failure — contributing is
 * best-effort and silent. Each entry is rebuilt field by field rather than
 * spread, so a future extra property on `Observation` can never ride along into
 * the shared database unnoticed; the server rejects unknown fields, and this
 * makes sure it never sees one.
 */
export async function pushObservations(
  deviceId: string,
  observations: readonly Observation[],
): Promise<number> {
  if (!isCatalogConfigured() || observations.length === 0) return 0;

  try {
    const response = await fetchWithTimeout(`${BASE_URL}/api/contribute`, SYNC_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        observations: observations.map((observation) => ({
          merchant: observation.merchant,
          hint: observation.hint,
          sender: observation.sender ?? null,
          direction: observation.direction,
          amountBucket: observation.amountBucket,
        })),
      }),
    });
    if (!response.ok) return 0;

    const body = (await response.json()) as { accepted?: unknown };
    return typeof body.accepted === 'number' ? body.accepted : 0;
  } catch {
    return 0;
  }
}
