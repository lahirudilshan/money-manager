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

import { checkHealth, healthStatusCode, HEALTH_HEADERS } from '@/lib/health';
import { json, preflight } from '@/lib/http';

export async function GET() {
  const report = await checkHealth();
  return json(report, healthStatusCode(report), HEALTH_HEADERS);
}

export function OPTIONS() {
  return preflight();
}
