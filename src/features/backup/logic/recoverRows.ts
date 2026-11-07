/**
 * Bringing specific tables back from an older copy, WITHOUT a full restore.
 *
 * ## Why not just restore or sync
 *
 * Buddy loans were missing from every backup (they belonged to no backup
 * part), but Drive sync wrote every table — so the sync file still held them.
 * Running a full sync against that old file would also merge everything else
 * in it, resurrecting rows deleted since (sync has no tombstones for rows a
 * restore wiped). This takes ONLY the named tables, and ONLY rows this phone
 * does not already have: nothing local is overwritten or removed.
 *
 * Pure — the database and Drive calls live with their own layers.
 */

export type Row = Record<string, unknown>;

/**
 * The rows from `source` worth adding: not already present by id, not
 * tombstoned (deleted on the device that wrote the file).
 */
export function missingRows(source: readonly Row[], localIds: ReadonlySet<string>): Row[] {
  return source.filter((row) => {
    const id = row.id;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (localIds.has(id)) return false;
    return row.deleted_at === null || row.deleted_at === undefined;
  });
}

/**
 * Keep only the columns this database has.
 *
 * The source may come from an older or newer build: an unknown column would
 * fail the insert, a missing one takes its default.
 */
export function onlyColumns(row: Row, columns: ReadonlySet<string>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) if (columns.has(key)) out[key] = value;
  return out;
}

/** What a recovery added, per table, for the message shown afterwards. */
export interface RecoveryReport {
  ok: boolean;
  added: Record<string, number>;
  /** Rows the source had in total, so "found 0" and "had them all" differ. */
  found: Record<string, number>;
  error?: string;
}
