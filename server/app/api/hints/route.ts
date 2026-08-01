/**
 * GET /api/hints?since=<cursor>&limit=<n>
 *
 * The winning hint per merchant, changed since the cursor — a paged view of
 * what the catalog currently believes.
 *
 * The app does NOT call this. Devices ask `/api/detect` per message rather than
 * mirroring the catalog locally, so that there is exactly one copy of the
 * merchant map and it cannot drift. This endpoint exists for moderation, for
 * inspecting the catalog's state, and as the e2e suite's window into vote
 * tallies and margins.
 *
 * Only the WINNING hint per merchant is returned; the table keeps every
 * competing pairing. `margin` is the winner's lead over the runner-up, so a
 * contested merchant is visibly contested rather than reading as settled.
 */

import { getCatalogPage } from '@/lib/catalog';
import { guard, preflight } from '@/lib/http';

/** Rows per page. Large enough for a full read to finish in a few requests. */
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** Epoch, at the microsecond precision the cursor comparison uses. */
const EPOCH = '1970-01-01T00:00:00.000000Z';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  /*
   * The cursor is "<iso>|<id>", not a bare timestamp.
   *
   * The timestamp is passed to Postgres as text and cast there, never through a
   * JS Date — a Date truncates the microseconds the cursor depends on, and a
   * truncated cursor sorts BEFORE the row it came from, serving that row forever
   * and hanging a paging client. `Date.parse` is used only to validate; its
   * numeric result is discarded.
   *
   * An absent or unparseable cursor means "everything": a first read, or a
   * caller whose stored cursor got corrupted. Epoch is safe because the response
   * is paged and idempotent.
   */
  const since = params.get('since');
  const [stampRaw, idRaw] = (since ?? '').split('|');
  const cursorStamp = stampRaw && !Number.isNaN(Date.parse(stampRaw)) ? stampRaw : EPOCH;
  const parsedId = Number(idRaw);
  const cursorId = Number.isFinite(parsedId) ? parsedId : 0;

  const parsedLimit = Number(params.get('limit'));
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return guard('hints', async () => {
    const page = await getCatalogPage(cursorStamp, cursorId, limit);
    // With no rows the caller keeps its own cursor rather than resetting.
    return { ...page, nextSince: page.nextSince ?? since ?? null };
  });
}

export function OPTIONS() {
  return preflight();
}
