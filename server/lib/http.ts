import type { ZodType } from 'zod';

/**
 * Route plumbing: CORS, JSON responses, and the request→validated-input step.
 *
 * Every route repeated the same twenty lines — parse the body, run the schema,
 * shape a 400, catch, log, 500 — which is exactly the code that quietly drifts
 * apart until one endpoint validates differently from the others. Here it is
 * once.
 *
 * CORS is permissive because the catalog is public-read and every write is
 * validated and vote-limited server-side. An origin allowlist would add no
 * security (a native app sends no Origin at all) while blocking a browser
 * dashboard later. `requireAppKey` below is the gate that does the filtering,
 * and it is honest about how much that is worth.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key',
  'Access-Control-Max-Age': '86400',
};

/**
 * Keys the app may present, newest first. Empty means the check is off.
 *
 * A LIST rather than one value so a key can be rotated without breaking every
 * installed build: ship a new key, keep the old one here until those versions
 * age out, then drop it. With a single value, rotating would lock out everyone
 * who had not updated.
 */
const APP_KEYS = (process.env.APP_KEYS ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter((key) => key.length > 0);

/**
 * Reject a caller that did not present a known app key.
 *
 * BE CLEAR ABOUT WHAT THIS IS: the key ships inside the app bundle, so anyone
 * who unpacks an install can read it. It is not authentication and it cannot
 * make the API "ours only" — that is not achievable for a public client, since
 * any secret the app holds is a secret the user's device holds.
 *
 * What it does buy, which is worth the ten lines:
 *
 *   - drive-by traffic (scanners, crawlers, someone who found the URL) is
 *     refused before it reaches Postgres;
 *   - a leaked or abused key can be REVOKED by editing one env var, without
 *     shipping an app update;
 *   - it separates "our builds" from everything else in the logs, so abuse is
 *     visible rather than buried in normal traffic.
 *
 * Unset `APP_KEYS` disables the check entirely, so an existing deployment and a
 * fresh clone both keep working until the key is deliberately configured.
 *
 * The real defences remain the ones that do not depend on a secret: per-client
 * rate limits, `.strict()` payloads, one vote per device, and recomputed tallies.
 */
export function requireAppKey(request: Request): Response | null {
  if (APP_KEYS.length === 0) return null;

  const presented = request.headers.get('x-app-key');
  if (presented && APP_KEYS.includes(presented)) return null;

  // Deliberately vague: a precise reason would help someone probe for a valid
  // key. Real clients either have it or do not.
  return json({ error: 'forbidden' }, 403);
}

/** A JSON response carrying the CORS headers. */
export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

/** The CORS preflight reply. Every route exports this as its OPTIONS handler. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Either a validated value or the Response to return instead.
 *
 * Returning the failure rather than throwing keeps the happy path in the route
 * un-nested, and means a caller cannot forget to handle it — the type does not
 * let you reach `.data` without checking.
 */
export type Validated<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Parse a JSON body against a schema.
 *
 * The schemas are `.strict()`, so an unknown field is a 400 rather than a
 * silently dropped one. That is the privacy boundary, not a formality: it is
 * what stops a modified client attaching raw SMS text, balances or account
 * numbers to a request. `issues` is echoed because a rejection is nearly always
 * a client bug, and naming the offending field is what makes it findable.
 */
export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<Validated<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: json({ error: 'body must be JSON' }, 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: json({ error: 'invalid payload', issues: parsed.error.issues }, 400),
    };
  }

  return { ok: true, data: parsed.data };
}

/** Parse URL search params against a schema, with the same contract. */
export function readQuery<T>(
  request: Request,
  schema: ZodType<T>,
  pick: (params: URLSearchParams) => unknown,
): Validated<T> {
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse(pick(params));

  if (!parsed.success) {
    return {
      ok: false,
      response: json({ error: 'invalid query', issues: parsed.error.issues }, 400),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Run a handler, turning an unexpected throw into a logged 500.
 *
 * `fallback` exists because two of the four routes must NOT fail loudly: the
 * device treats an empty answer as "fall back to local detection", so a catalog
 * outage should cost accuracy rather than block someone logging a transaction.
 * Passing a fallback opts into that; omitting it gives an honest 500.
 */
export async function guard<T>(
  label: string,
  handler: () => Promise<T>,
  fallback?: T,
): Promise<Response> {
  try {
    return json(await handler());
  } catch (error) {
    console.error(`${label} failed`, error);
    if (fallback !== undefined) return json(fallback);
    return json({ error: `${label} unavailable` }, 500);
  }
}
