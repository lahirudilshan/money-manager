/**
 * Reading the whole board out, and writing a whole board back in.
 *
 * The pure format lives in core/backup.ts; this is the only part that touches
 * SQLite. Kept separate from repositories.ts because it works at a different
 * level entirely — raw tables rather than domain objects — and because a
 * restore is the single most destructive operation in the app and deserves to
 * be read in isolation.
 */

import { expoDb } from './client';
import {
  ALL_PARTS,
  buildSnapshot,
  SNAPSHOT_TABLES,
  tablesForParts,
  tablesForScope,
  validateSnapshot,
  type BackupPartKey,
  type RestoreScope,
  type Snapshot,
  type SnapshotTable,
  type TableRows,
} from '../core/backup';

/** Whether a table exists, so a snapshot from a build with more tables than
 *  this one does not abort the restore. */
function tableExists(table: string): boolean {
  const row = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  return row !== null && row !== undefined;
}

/**
 * Read every backed-up table.
 *
 * Tables the current build does not have are skipped rather than throwing: a
 * device mid-migration, or one running an older build, should still be able to
 * export what it does have.
 */
export function exportSnapshot(
  appVersion: string,
  options: {
    /** Which parts to include. Defaults to everything. */
    parts?: BackupPartKey[];
    /** The user's own name for this backup. */
    label?: string;
  } = {},
): Snapshot {
  const parts = options.parts ?? ALL_PARTS;

  /*
   * Only the SELECTED tables are read.
   *
   * Excluded ones are written as empty arrays by `buildSnapshot`, which is what
   * keeps the file's shape stable — a reader never has to tell "no rows" from
   * "this version had no such table" — while the row counts honestly report
   * zero for anything left out.
   */
  const wanted = new Set(tablesForParts(parts));
  const tables: Partial<Record<SnapshotTable, TableRows>> = {};

  for (const table of SNAPSHOT_TABLES) {
    if (!wanted.has(table) || !tableExists(table)) continue;
    tables[table] = expoDb.getAllSync(`SELECT * FROM ${table}`) as TableRows;
  }

  return buildSnapshot(tables, { appVersion, parts, label: options.label });
}

/** What a restore did, for the confirmation the user sees. */
export interface RestoreResult {
  ok: boolean;
  /** Rows written, per table. */
  written: Record<string, number>;
  /** Tables in the file this build has no table for — reported, not fatal. */
  skipped: string[];
  error?: string;
}

/**
 * Replace the entire local board with a snapshot's contents.
 *
 * DESTRUCTIVE, and structured around that fact:
 *
 *   - the snapshot is validated BEFORE anything is deleted, so a corrupt file
 *     cannot destroy a good board;
 *   - the whole thing runs in ONE transaction, so a failure halfway rolls back
 *     to exactly the board the user started with rather than leaving a
 *     half-restored mess;
 *   - foreign keys are disabled for the duration, because the tables are
 *     cleared and refilled in dependency order and an intermediate state
 *     legitimately violates constraints that hold again at commit.
 *
 * `sms_inbox` is deliberately untouched: it is not in a snapshot (see
 * core/backup.ts), and clearing the user's pending review queue because they
 * restored a backup would be a surprise with no upside.
 */
export function restoreSnapshot(
  snapshot: Snapshot,
  /**
   * How much to bring back.
   *
   * A `RestoreScope` is the coarse form kept for existing callers; an explicit
   * list of parts is what the UI now passes, so the user can bring back their
   * categories without last year's transactions.
   */
  scope: RestoreScope | readonly BackupPartKey[] = 'everything',
): RestoreResult {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    return { ok: false, written: {}, skipped: [], error: validation.problems.join(' ') };
  }

  const written: Record<string, number> = {};
  const skipped: string[] = [];

  try {
    expoDb.execSync('PRAGMA foreign_keys = OFF;');
    expoDb.execSync('BEGIN TRANSACTION;');

    /*
     * Clear in REVERSE dependency order, then insert forwards.
     *
     * Deleting a parent before its children would strand rows even with foreign
     * keys off, because the children's own delete would then have nothing to
     * match — and any `ON DELETE CASCADE` still fires while the pragma is off
     * for statements that reference it.
     *
     * Only the tables this scope will REWRITE are touched. On a `setup` restore
     * the history tables are left completely alone rather than emptied:
     * clearing them would delete the user's transactions while claiming to
     * restore only structure, which is the opposite of what the option
     * promises. Their rows are then orphaned by the new structure — which is
     * why the UI recommends setup-only for a fresh board.
     */
    const tables = Array.isArray(scope)
      ? tablesForParts(scope as BackupPartKey[])
      : tablesForScope(scope as RestoreScope);

    for (const table of [...tables].reverse()) {
      if (!tableExists(table)) continue;
      expoDb.execSync(`DELETE FROM ${table};`);
    }

    for (const table of tables) {
      const rows = snapshot.tables[table];
      if (!rows || rows.length === 0) continue;

      if (!tableExists(table)) {
        skipped.push(table);
        continue;
      }

      /*
       * Only write columns this build actually has.
       *
       * A snapshot from a NEWER app carries columns this schema lacks, and
       * naming them in an INSERT is a hard error that would abort the whole
       * restore. Intersecting with the live table means a forward-compatible
       * restore drops what it cannot represent and keeps everything it can —
       * degraded, but not refused.
       */
      const liveColumns = new Set(
        (expoDb.getAllSync(`PRAGMA table_info(${table})`) as { name: string }[]).map((c) => c.name),
      );

      let count = 0;
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => liveColumns.has(column));
        if (columns.length === 0) continue;

        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((column) => normalise(row[column]));

        expoDb.runSync(
          `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          values,
        );
        count += 1;
      }

      written[table] = count;
    }

    expoDb.execSync('COMMIT;');
    return { ok: true, written, skipped };
  } catch (error) {
    try {
      expoDb.execSync('ROLLBACK;');
    } catch {
      // Nothing to roll back — the failure was opening the transaction itself.
    }
    return { ok: false, written: {}, skipped, error: String(error) };
  } finally {
    expoDb.execSync('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Coerce a JSON value into something SQLite can bind.
 *
 * JSON has no integer/boolean distinction that SQLite recognises, so a `true`
 * round-tripped through a backup would arrive as a value the driver rejects.
 * Booleans become 0/1 (matching how Drizzle stores them), and anything
 * structural is re-serialised rather than dropped.
 */
function normalise(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}
