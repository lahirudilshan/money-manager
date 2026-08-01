import 'server-only';

import { sql } from './db';
import type { AmountBucket, Hint } from './contract';

/**
 * Every SQL statement in the service, and nothing else.
 *
 * Keeping queries out of the scoring and route layers means the ranking rules
 * can be read without wading through SQL, and a query can be tuned without
 * touching logic. It also puts the one genuinely subtle piece of SQL — merchant
 * containment — in a single place rather than copy-pasted per call site.
 */

/** Votes a learned pairing needs before it is served to anyone. */
export const MIN_VOTES = 3;

/**
 * Merchant keys shorter than this are never used for containment matching.
 *
 * "ceb" or "ioc" inside a longer merchant name is almost always coincidence
 * ("iocm consulting" is not a fuel station), and a false positive here is worse
 * than a miss: it teaches every device the wrong category with confidence.
 */
const MIN_CONTAINMENT_LEN = 5;

/**
 * Merchants that match `key`, exactly or by containment either way.
 *
 * POS text appends branches and cities, so `F L I TRADING GALLE` normalises to
 * `fli trading galle` — not EQUAL to the `fli trading` the crowd voted on.
 * Exact-only matching failed to recognise a shop the catalog knew perfectly
 * well, which is the most visible way this feature can look broken.
 *
 * Written as a fragment used by both queries below so the two can never
 * disagree about what "the same merchant" means.
 */
function merchantMatches(key: string) {
  return sql`(
    merchant = ${key}
    OR (length(merchant) >= ${MIN_CONTAINMENT_LEN} AND position(merchant in ${key}) > 0)
    OR (length(${key}) >= ${MIN_CONTAINMENT_LEN} AND position(${key} in merchant) > 0)
  )`;
}

export interface HintVotes {
  hint: Hint;
  votes: number;
}

/** Vote tallies for a merchant, strongest first. */
export async function votesForMerchant(key: string): Promise<HintVotes[]> {
  return (await sql`
    SELECT hint, votes FROM merchant_hints
     WHERE blocked = FALSE AND ${merchantMatches(key)}
     ORDER BY (merchant = ${key}) DESC, length(merchant) DESC, votes DESC, hint ASC
     LIMIT 8
  `) as HintVotes[];
}

export interface HintCount {
  hint: Hint;
  n: number;
}

/** Observation counts for a merchant narrowed to this transaction's shape. */
export async function signalsForMerchant(
  key: string,
  direction: 'debit' | 'credit',
  bucket: AmountBucket,
): Promise<HintCount[]> {
  return (await sql`
    SELECT hint, sum(observations)::int AS n
      FROM merchant_signals
     WHERE direction = ${direction} AND amt_bucket = ${bucket} AND ${merchantMatches(key)}
     GROUP BY hint
     ORDER BY n DESC
     LIMIT 8
  `) as HintCount[];
}

/** Observation counts for everything a bank short code has ever sent. */
export async function signalsForSender(
  sender: string,
  direction: 'debit' | 'credit',
): Promise<HintCount[]> {
  return (await sql`
    SELECT hint, sum(observations)::int AS n
      FROM merchant_signals
     WHERE sender = ${sender} AND direction = ${direction}
     GROUP BY hint
     ORDER BY n DESC
     LIMIT 8
  `) as HintCount[];
}

export interface CatalogRow {
  id: string;
  merchant: string;
  hint: Hint;
  votes: number;
  source: 'seed' | 'learned';
  margin: number;
  cursor_stamp: string;
}

/**
 * A page of winning hints, one per merchant, changed since the cursor.
 *
 * Ranking runs over ALL candidate hints and the popularity floor is applied
 * afterwards to the winner alone. Filtering first would hide the runner-up and
 * inflate `margin` — a merchant split 5 groceries / 4 fuel would report margin 5
 * and reach devices looking unanimous, which is the disagreement the client's
 * threshold exists to catch.
 *
 * `cursor_stamp` is formatted in SQL at microsecond precision: Postgres stores
 * microseconds, a JS Date holds milliseconds, and round-tripping through a Date
 * truncates .984692 to .984 — which sorts BEFORE the row it came from, serving
 * that row forever and hanging a paging client.
 */
export async function catalogPage(
  cursorStamp: string,
  cursorId: number,
  limit: number,
): Promise<CatalogRow[]> {
  return (await sql`
    WITH ranked AS (
      SELECT
        id, merchant, hint, votes, source, updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY merchant
          ORDER BY (source = 'seed') DESC, votes DESC, hint ASC
        ) AS rank,
        votes - COALESCE(
          LEAD(votes) OVER (
            PARTITION BY merchant
            ORDER BY (source = 'seed') DESC, votes DESC, hint ASC
          ), 0
        ) AS margin
      FROM merchant_hints
      WHERE blocked = FALSE
    )
    SELECT
      id, merchant, hint, votes, source, margin,
      to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_stamp
    FROM ranked
    WHERE rank = 1
      AND (source = 'seed' OR votes >= ${MIN_VOTES})
      AND (updated_at, id) > (${cursorStamp}::timestamptz, ${cursorId}::bigint)
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit}
  `) as CatalogRow[];
}

/** Whether a merchant has been forced out of circulation by a moderator. */
export async function isBlocked(key: string): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM merchant_hints WHERE merchant = ${key} AND blocked = TRUE LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

/** What this device previously said about a merchant, if anything. */
export async function previousVote(deviceId: string, key: string): Promise<Hint | null> {
  const rows = (await sql`
    SELECT hint FROM merchant_votes WHERE device_id = ${deviceId} AND merchant = ${key}
  `) as { hint: Hint }[];
  return rows[0]?.hint ?? null;
}

/**
 * Record one device's vote and re-tally what it affects.
 *
 * Tallies are RECOMPUTED from the votes table, never incremented: an
 * `UPDATE ... votes = votes + 1` drifts the moment a request is retried or a
 * vote moves between hints, and this catalog is served to every user, so drift
 * is permanent and invisible.
 */
export async function castVote(deviceId: string, key: string, hint: Hint): Promise<void> {
  const previous = await previousVote(deviceId, key);

  await sql`
    INSERT INTO merchant_votes (device_id, merchant, hint)
    VALUES (${deviceId}, ${key}, ${hint})
    ON CONFLICT (device_id, merchant)
    DO UPDATE SET hint = EXCLUDED.hint, updated_at = now()
  `;

  await sql`
    INSERT INTO merchant_hints (merchant, hint, votes, source)
    VALUES (${key}, ${hint}, 0, 'learned')
    ON CONFLICT (merchant, hint) DO NOTHING
  `;

  await sql`SELECT retally(${key}, ${hint})`;

  // The abandoned hint loses this device's vote, or it would stay inflated
  // forever by a mapping the user has since corrected.
  if (previous && previous !== hint) {
    await sql`SELECT retally(${key}, ${previous})`;
  }
}

/**
 * Record the transaction's shape.
 *
 * Counted per observation rather than deduplicated per device: how OFTEN a
 * shape occurs is the signal, and one device shopping weekly is genuine
 * evidence. The winner-picking vote above stays deduplicated, so this cannot be
 * used to swing the top suggestion.
 *
 * `sender` is '' rather than NULL when absent because it is part of the unique
 * key, and NULL never equals NULL in SQL — a nullable column would make
 * ON CONFLICT miss and duplicate the row on every contribution.
 */
export async function recordSignal(
  key: string,
  hint: Hint,
  sender: string | null,
  direction: 'debit' | 'credit',
  bucket: AmountBucket,
): Promise<void> {
  await sql`
    INSERT INTO merchant_signals (merchant, hint, sender, direction, amt_bucket, observations)
    VALUES (${key}, ${hint}, ${sender ?? ''}, ${direction}, ${bucket}, 1)
    ON CONFLICT (merchant, hint, sender, direction, amt_bucket)
    DO UPDATE SET
      observations = merchant_signals.observations + 1,
      updated_at = now()
  `;
}
