import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The repair that teaches the log about resolutions it never saw.
 *
 * ## The bug being repaired
 *
 * `smsLogRepo.record` was called on the intake path only, so a message froze
 * at its arrival outcome. Confirming a draft resolved its `sms_inbox` row and
 * left `sms_log` untouched — on the user's device, 17 rows `confirmed` in the
 * inbox against 0 in the log, every one still reading `queued`. A payment
 * split across two lines looked as though it had never been filed.
 *
 * ## Why this runs real SQL
 *
 * `client.ts` opens a device database on import and cannot be loaded under
 * vitest, and the repair is almost entirely SQL — a hand-written paraphrase
 * would test this file rather than the shipped statements. So the statements
 * are EXTRACTED from `client.ts` and executed against a real in-memory SQLite
 * database. If someone edits the query in `client.ts`, this test runs the
 * edited one.
 */

const CLIENT = readFileSync(new URL('../client.ts', import.meta.url), 'utf8');

/** The body of `backfillResolvedSmsLog`, as shipped. */
const BACKFILL = (() => {
  const start = CLIENT.indexOf('function backfillResolvedSmsLog');
  expect(start).toBeGreaterThan(-1);
  const end = CLIENT.indexOf('\nfunction ', start + 1);
  return CLIENT.slice(start, end === -1 ? undefined : end);
})();

/** One backtick-quoted SQL statement out of that body, by a distinctive phrase. */
function sqlContaining(fragment: string): string {
  for (const match of BACKFILL.matchAll(/`([^`]+)`/g)) {
    if (match[1].includes(fragment)) return match[1];
  }
  throw new Error(`no SQL in backfillResolvedSmsLog containing "${fragment}"`);
}

const SELECT_STALE = sqlContaining('LEFT JOIN sms_log');
const UPDATE_EXISTING = sqlContaining('UPDATE sms_log');
const INSERT_MISSING = sqlContaining('INSERT INTO sms_log');

/** The two tables, shaped as `client.ts` declares them. */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sms_inbox (
      id TEXT PRIMARY KEY NOT NULL, raw TEXT NOT NULL, fingerprint TEXT NOT NULL,
      status TEXT NOT NULL, kind TEXT, amount_minor INTEGER, merchant TEXT,
      occurred_on TEXT, resolved_at INTEGER
    );
    CREATE TABLE sms_log (
      id TEXT PRIMARY KEY NOT NULL, raw TEXT NOT NULL, fingerprint TEXT NOT NULL,
      outcome TEXT NOT NULL, reason TEXT, source TEXT NOT NULL DEFAULT 'file',
      amount_minor INTEGER, merchant TEXT, kind TEXT, occurred_on TEXT,
      seen_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX sms_log_fingerprint_idx ON sms_log(fingerprint);
  `);
  return db;
}

/** Run the shipped statements the way `backfillResolvedSmsLog` runs them. */
function runBackfill(db: DatabaseSync): number {
  const stale = db.prepare(SELECT_STALE).all() as Record<string, unknown>[];
  for (const row of stale) {
    if (row.logged) {
      db.prepare(UPDATE_EXISTING).run(
        row.status as string,
        (row.resolved_at as number | null) ?? null,
        row.fingerprint as string,
      );
    } else {
      db.prepare(INSERT_MISSING).run(
        `log_${row.fingerprint as string}`,
        row.raw as string,
        row.fingerprint as string,
        row.status as string,
        'Restored from the review queue',
        (row.amount_minor as number | null) ?? null,
        (row.merchant as string | null) ?? null,
        (row.kind as string | null) ?? null,
        (row.occurred_on as string | null) ?? null,
        (row.resolved_at as number | null) ?? Date.now(),
      );
    }
  }
  return stale.length;
}

const inbox = (db: DatabaseSync, id: string, status: string, resolvedAt: number | null = 500) =>
  db
    .prepare(
      `INSERT INTO sms_inbox (id, raw, fingerprint, status, kind, amount_minor, merchant, occurred_on, resolved_at)
       VALUES (?, ?, ?, ?, 'debit', 1000, 'Shop', '2026-09-01', ?)`,
    )
    .run(id, `raw ${id}`, `fp_${id}`, status, resolvedAt);

const log = (db: DatabaseSync, id: string, outcome: string, seenAt = 100) =>
  db
    .prepare(
      `INSERT INTO sms_log (id, raw, fingerprint, outcome, source, amount_minor, seen_at)
       VALUES (?, ?, ?, ?, 'file', 1000, ?)`,
    )
    .run(`log_${id}`, `raw ${id}`, `fp_${id}`, outcome, seenAt);

const outcomeOf = (db: DatabaseSync, id: string) =>
  (db.prepare(`SELECT outcome FROM sms_log WHERE fingerprint = ?`).get(`fp_${id}`) as
    | { outcome: string }
    | undefined)?.outcome;

describe('backfillResolvedSmsLog', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = freshDb();
  });

  it('updates a confirmed message the log left reading queued', () => {
    inbox(db, 'a', 'confirmed');
    log(db, 'a', 'queued');

    runBackfill(db);

    expect(outcomeOf(db, 'a')).toBe('confirmed');
  });

  it('updates a dismissed message the same way', () => {
    inbox(db, 'b', 'dismissed');
    log(db, 'b', 'queued');

    runBackfill(db);

    expect(outcomeOf(db, 'b')).toBe('dismissed');
  });

  /* One of the user's 17 had no log row at all — intake never recorded it. */
  it('inserts a row for a message the log never saw', () => {
    inbox(db, 'c', 'confirmed');

    runBackfill(db);

    expect(outcomeOf(db, 'c')).toBe('confirmed');
    const row = db
      .prepare(`SELECT source, merchant, amount_minor FROM sms_log WHERE fingerprint = 'fp_c'`)
      .get() as { source: string; merchant: string; amount_minor: number };
    // Every field recoverable from the inbox is carried across rather than
    // guessed, so the restored row reads like the ones recorded live.
    expect(row.source).toBe('backfill');
    expect(row.merchant).toBe('Shop');
    expect(row.amount_minor).toBe(1000);
  });

  it('leaves a still-pending message queued', () => {
    inbox(db, 'd', 'pending');
    log(db, 'd', 'queued');

    runBackfill(db);

    expect(outcomeOf(db, 'd')).toBe('queued');
  });

  it('does not touch an unrelated intake outcome', () => {
    log(db, 'e', 'ignored');

    runBackfill(db);

    expect(outcomeOf(db, 'e')).toBe('ignored');
  });

  /*
   * The repair is shape-driven, not version-gated: it must find nothing to do
   * on the second launch, or every start would rewrite the same rows.
   */
  it('is idempotent', () => {
    inbox(db, 'f', 'confirmed');
    log(db, 'f', 'queued');

    expect(runBackfill(db)).toBe(1);
    expect(runBackfill(db)).toBe(0);
  });

  /*
   * The history screen orders by `seen_at`. Stamping "now" would drag every
   * repaired message to the top and reorder a history already read.
   */
  it('dates the row by when it was resolved, not when it was repaired', () => {
    inbox(db, 'g', 'confirmed', 777);
    log(db, 'g', 'queued', 100);

    runBackfill(db);

    const row = db
      .prepare(`SELECT seen_at FROM sms_log WHERE fingerprint = 'fp_g'`)
      .get() as { seen_at: number };
    expect(row.seen_at).toBe(777);
  });

  it('keeps the existing date when the inbox recorded none', () => {
    inbox(db, 'h', 'confirmed', null);
    log(db, 'h', 'queued', 100);

    runBackfill(db);

    const row = db
      .prepare(`SELECT seen_at FROM sms_log WHERE fingerprint = 'fp_h'`)
      .get() as { seen_at: number };
    expect(row.seen_at).toBe(100);
  });

  it('never duplicates a fingerprint', () => {
    inbox(db, 'i', 'confirmed');
    log(db, 'i', 'queued');

    runBackfill(db);
    runBackfill(db);

    const count = db
      .prepare(`SELECT count(*) AS n FROM sms_log WHERE fingerprint = 'fp_i'`)
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  /* The shape actually found on the device: 17 confirmed, 4 dismissed, 1 left. */
  it('repairs a whole queue the way the device needs', () => {
    for (let i = 0; i < 17; i += 1) {
      inbox(db, `c${i}`, 'confirmed');
      log(db, `c${i}`, 'queued');
    }
    for (let i = 0; i < 4; i += 1) {
      inbox(db, `d${i}`, 'dismissed');
      log(db, `d${i}`, 'queued');
    }
    inbox(db, 'p', 'pending');
    log(db, 'p', 'queued');

    runBackfill(db);

    const counts = db
      .prepare(`SELECT outcome, count(*) AS n FROM sms_log GROUP BY outcome`)
      .all() as { outcome: string; n: number }[];
    const byOutcome = Object.fromEntries(counts.map((r) => [r.outcome, r.n]));

    expect(byOutcome).toEqual({ confirmed: 17, dismissed: 4, queued: 1 });
  });
});
