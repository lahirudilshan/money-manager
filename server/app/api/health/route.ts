/**
 * GET /api/health — is this deployment actually serving?
 *
 * Answers the one question a monitor, a deploy check or a bisect needs: can the
 * API reach its database and see its schema, right now. It is the endpoint to
 * hit first when the app stops receiving hints, because it separates "the
 * service is down" from "the service is up and the data is wrong" — two
 * failures that look identical from the app, which swallows every error by
 * design (see services/catalogApi.ts).
 *
 * Three deliberate departures from the other routes:
 *
 *  1. NO app key. An uptime monitor, a load balancer probe and a deploy script
 *     cannot present one, and a health check that requires a secret is a health
 *     check nobody runs. It discloses nothing an attacker could not learn by
 *     calling any other route and watching it succeed or fail.
 *  2. NO rate limit. If this is being hammered, the honest response is still to
 *     answer — a 429 from a health check reads as an outage and would page
 *     someone at 3am for nothing. The query is a single indexed count.
 *  3. NO cache. `'use cache'` here would report the last known state rather than
 *     the current one, which is precisely the failure mode a health check exists
 *     to catch. The database query also stops prerendering, so this is
 *     request-time by construction under `cacheComponents`.
 *
 * The status code is what monitors alert on, so it has to be honest: 200 only
 * when a query actually succeeded, 503 otherwise. A body that says
 * `"status": "error"` under a 200 would be silently ignored by every uptime
 * tool on the market.
 */

import * as repo from '@/lib/repository';
import { json, preflight } from '@/lib/http';

export async function GET() {
  const startedAt = Date.now();

  try {
    const merchants = await repo.catalogSize();

    return json(
      {
        status: 'ok',
        database: 'reachable',
        /*
         * Included because "reachable but empty" is a real and confusing
         * failure — a fresh deploy pointed at an unseeded branch answers every
         * request with a valid, empty catalog, and the app degrades silently to
         * local-only detection with nothing anywhere reporting a problem.
         */
        merchants,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
      200,
      // Belt and braces against a CDN or proxy that caches 200s by default.
      { 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    // Logged in full for the operator; the response stays vague because this
    // endpoint is unauthenticated and a driver error can name hosts and roles.
    console.error('health check failed', error);

    return json(
      {
        status: 'error',
        database: 'unreachable',
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
      503,
      { 'Cache-Control': 'no-store' },
    );
  }
}

export function OPTIONS() {
  return preflight();
}
