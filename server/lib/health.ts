import 'server-only';

import * as repo from './repository';

/**
 * The health check itself, shared by `/` and `/api/health`.
 *
 * Extracted rather than duplicated because two copies of a health check are
 * worse than none: they drift, and the day they disagree is the day you cannot
 * tell which one is lying about a live incident.
 */

export interface HealthReport {
  status: 'ok' | 'error';
  database: 'reachable' | 'unreachable';
  /**
   * Rows in the catalog. Present only when the query succeeded.
   *
   * Reported because "reachable but empty" is a real and confusing failure — a
   * deploy pointed at an unseeded branch answers every request with a valid,
   * empty catalog, and the app degrades silently to local-only detection with
   * nothing anywhere reporting a problem.
   */
  merchants?: number;
  latencyMs: number;
  checkedAt: string;
}

/**
 * Probe the catalog database and describe what happened.
 *
 * Never throws: a health check that 500s tells you less than one that reports
 * its own failure, because a 500 looks identical to the platform being down.
 * The HTTP status is the caller's job — see `healthStatusCode`.
 */
export async function checkHealth(): Promise<HealthReport> {
  const startedAt = Date.now();

  try {
    const merchants = await repo.catalogSize();

    return {
      status: 'ok',
      database: 'reachable',
      merchants,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Logged in full for the operator; the response stays vague because these
    // endpoints are unauthenticated and a driver error can name hosts and roles.
    console.error('health check failed', error);

    return {
      status: 'error',
      database: 'unreachable',
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * 200 when healthy, 503 otherwise.
 *
 * Separate from the report because the status code is what monitors alert on,
 * and it has to be honest: a body saying `"status": "error"` under a 200 is
 * silently ignored by every uptime tool on the market.
 */
export function healthStatusCode(report: HealthReport): number {
  return report.status === 'ok' ? 200 : 503;
}

/** Headers both endpoints send, so neither can be cached into a stale answer. */
export const HEALTH_HEADERS: Record<string, string> = { 'Cache-Control': 'no-store' };
