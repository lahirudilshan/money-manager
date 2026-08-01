import 'server-only';

/**
 * A small in-process rate limiter for the write endpoint.
 *
 * The catalog is unauthenticated by design — requiring accounts for a
 * local-first budgeting app would be a worse trade than the abuse it prevents.
 * That makes a cheap ceiling on writes necessary: without one, a single script
 * can burn Neon compute (which is billed) and flood the vote tables.
 *
 * KNOWN LIMIT: state is per serverless instance, so the effective ceiling is
 * this limit times the number of warm instances. That is deliberate — it stops
 * the runaway-loop and casual-abuse cases that actually threaten the bill,
 * without adding Redis and a network round-trip to the hot path. A determined
 * attacker with many IPs is not stopped here; the vote-per-device rule and the
 * `blocked` column are what limit the damage they can do to the DATA, which is
 * the thing worth protecting.
 */

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Window>();

/** Entries to hold before sweeping, so a long-lived instance cannot grow forever. */
const MAX_TRACKED = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfter: number;
}

/**
 * Consume `cost` units from `key`'s budget for the current window.
 *
 * Cost, not request count, is what the ceiling is expressed in: the write
 * endpoint accepts up to 100 observations per request, so counting requests
 * would let one caller do a hundred times the database work of another for the
 * same budget. Charging per observation makes the limit track the thing that
 * actually costs money.
 */
export function rateLimit(key: string, limit: number, cost = 1): RateLimitResult {
  const now = Date.now();

  // Sweep expired windows when the map gets large. Cheap because it only runs
  // at the threshold, and bounded because it drops everything already expired.
  if (buckets.size > MAX_TRACKED) {
    for (const [bucketKey, window] of buckets) {
      if (window.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: cost, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }

  if (existing.count + cost > limit) {
    // Not charged when refused, so a rejected caller cannot push its own reset
    // further away by continuing to retry.
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += cost;
  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client identity for rate limiting.
 *
 * Prefers the platform's own header, which a client cannot spoof, and falls
 * back to the leftmost X-Forwarded-For entry. Used ONLY for rate limiting —
 * never stored, never logged, never associated with a vote.
 */
export function clientKey(request: Request): string {
  const direct = request.headers.get('x-real-ip');
  if (direct) return direct;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'unknown';
}
