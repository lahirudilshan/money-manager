/**
 * POST /api/contribute — the learning path.
 *
 * A user confirmed or corrected a draft's category, so that observation becomes
 * evidence for every other user. This is the only way the catalog grows, and
 * it is why accuracy improves as more people use the app.
 *
 * Three rules make the crowd data trustworthy:
 *
 *  1. one VOTE per device per merchant. Changing your mind MOVES the vote
 *     (primary key is (device_id, merchant)), so a correction retracts the old
 *     tally rather than leaving it inflated forever.
 *  2. tallies are recomputed from the votes table, never incremented — retries
 *     and moved votes both leave the count exactly right.
 *  3. the payload is `.strict()`, so an unknown field is a 400 rather than a
 *     silently accepted leak. This is what keeps message text, balances and
 *     account numbers out of a database every user can read.
 */

import { revalidateTag } from 'next/cache';
import { CATALOG_TAG } from '@/lib/catalog';
import { contributeSchema } from '@/lib/contract';
import { merchantKey } from '@/lib/db';
import { guard, json, preflight, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/rateLimit';
import * as repo from '@/lib/repository';

/**
 * Observations per minute per client — not requests.
 *
 * A request may carry up to MAX_OBSERVATIONS, so a request-based ceiling would
 * let one caller do a hundred times the database work of another for the same
 * budget. Set high enough that a device flushing a genuine backlog after days
 * offline sails through, and low enough to stop a runaway loop within a minute.
 * Several devices behind one NAT share this, which is another reason not to set
 * it tight.
 */
const WRITE_LIMIT = 600;

export async function POST(request: Request) {
  const input = await readJson(request, contributeSchema);
  if (!input.ok) return input.response;

  const { deviceId, observations } = input.data;

  // Normalise before touching the database, so one malformed entry cannot leave
  // a request half-applied.
  const clean = observations
    .map((observation) => ({ ...observation, merchant: merchantKey(observation.merchant) }))
    .filter((observation) => observation.merchant.length > 0);

  if (clean.length === 0) {
    return json({ error: 'no usable observations after normalisation' }, 400);
  }

  // Charged after validation so the cost is known, and so a malformed payload is
  // rejected on its own merits rather than eating the caller's budget.
  const limit = rateLimit(clientKey(request), WRITE_LIMIT, clean.length);
  if (!limit.ok) {
    return json({ error: 'too many requests' }, 429, { 'Retry-After': String(limit.retryAfter) });
  }

  return guard('contribute', async () => {
    let accepted = 0;
    let skipped = 0;

    for (const { merchant, hint, sender, direction, amountBucket } of clean) {
      // Blocked merchants are silently accepted but never recorded — a spammer
      // gets no signal that their entry is being dropped.
      if (await repo.isBlocked(merchant)) {
        skipped++;
        continue;
      }

      await repo.castVote(deviceId, merchant, hint);
      await repo.recordSignal(merchant, hint, sender ?? null, direction, amountBucket);
      accepted++;
    }

    /*
     * Make the correction visible to everyone now, rather than after the TTL.
     *
     * 'max' is stale-while-revalidate: the next reader gets the existing cache
     * instantly while a fresh one builds behind it. The contributor never waits
     * for a rebuild and no reader ever blocks on one — which matters because
     * this fires on every confirmed draft.
     */
    revalidateTag(CATALOG_TAG, 'max');

    // `skipped` is reported rather than folded into `accepted` so a client that
    // sends 10 and sees 9 recorded can tell "one was dropped" from "one failed".
    return { accepted, skipped };
  });
}

export function OPTIONS() {
  return preflight();
}
