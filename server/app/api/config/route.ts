/**
 * GET /api/config — settings the app reads at runtime instead of shipping.
 *
 * Today that is the shared Shortcuts link for SMS intake. iCloud shortcut links
 * bind to the app's bundle id, so a rename or a rebuilt automation means a new
 * link; serving it from here means changing a row, not releasing the app.
 *
 * Any failure answers `{}` with a 200: the app treats a missing field as "keep
 * what you have", so an outage leaves every install on its last good value.
 */

import { getAppConfig } from '@/lib/appConfig';
import { guard, json, preflight, requireAppKey } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/rateLimit';

/**
 * A device asks once per visit to one settings screen. Its own bucket, so a
 * busy SMS day on /api/detect never starves this read, or the reverse.
 */
const CONFIG_LIMIT = 30;

export async function GET(request: Request) {
  const forbidden = requireAppKey(request);
  if (forbidden) return forbidden;

  const limited = rateLimit(`config:${clientKey(request)}`, CONFIG_LIMIT);
  if (!limited.ok) {
    return json({ error: 'too many requests' }, 429, {
      'Retry-After': String(limited.retryAfter),
    });
  }

  return guard('config', getAppConfig, {});
}

export function OPTIONS() {
  return preflight();
}
