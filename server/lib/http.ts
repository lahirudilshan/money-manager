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
 * dashboard later.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

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
