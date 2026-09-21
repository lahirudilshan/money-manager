/**
 * Merging two devices' data into one.
 *
 * ## Why a merge and not a restore
 *
 * The backup system already turns the database into a `Snapshot` and back, and
 * the obvious way to sync two phones is to upload one snapshot and restore it
 * on the other. That is exactly wrong: `restoreSnapshot` CLEARS each table
 * before inserting, so whichever phone uploads last erases the other's day.
 * Two people adding a transaction each within the same hour would keep one of
 * them, silently, with no error to notice.
 *
 * So the file in Drive is not a backup that gets restored. It is a shared
 * state that each device merges INTO before writing back.
 *
 * ## The rule
 *
 * Rows are matched by `id` and the newest `updated_at` wins. Every table in the
 * snapshot carries that column, so the rule is uniform — there is no per-table
 * special casing to get wrong, and a row nobody touched is byte-identical on
 * both sides and merges to itself.
 *
 * This is last-writer-wins PER ROW, which is the honest ceiling for a system
 * with no server to order events. Two people editing the SAME row within the
 * same minute will still lose one edit; two people editing different rows —
 * overwhelmingly the common case — both keep theirs.
 *
 * ## Deletes
 *
 * A deleted row is absent, and absence is indistinguishable from "not created
 * yet". Merging naively would resurrect everything either side deleted. So
 * deletion is recorded as a TOMBSTONE — the row stays with `deleted_at` set —
 * and tombstones merge by the same timestamp rule as anything else. See
 * `pruneTombstones` for when they are finally dropped.
 */

/** One row, as the snapshot stores it: a flat map of column to value. */
export type Row = Record<string, unknown>;

/** Every row of one table. */
export type TableRows = Row[];

/**
 * The columns this module depends on. A row missing them cannot be merged and
 * is treated as older than anything that has them — see `rowTime`.
 */
export const ID_COLUMN = 'id';
export const UPDATED_COLUMN = 'updated_at';
export const DELETED_COLUMN = 'deleted_at';

/**
 * When a row last changed, in epoch ms.
 *
 * Zero when the column is missing or unusable, which makes such a row lose
 * every comparison rather than win them: a row with no timestamp is one this
 * system cannot reason about, and silently preferring it would overwrite data
 * it knows nothing about.
 */
export function rowTime(row: Row): number {
  const raw = row[UPDATED_COLUMN];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  // Timestamps survive JSON as numbers, but a hand-edited file may hold a
  // string; parse it rather than discarding the row's history.
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return date;
  }
  return 0;
}

/** Whether this row is a tombstone — deleted, but kept so the delete travels. */
export function isDeleted(row: Row): boolean {
  const raw = row[DELETED_COLUMN];
  return raw !== null && raw !== undefined && raw !== 0 && raw !== '';
}

/**
 * Merge two versions of one table.
 *
 * Neither input is mutated. The result is ordered by id so two devices that
 * merged the same pair produce byte-identical output — without that, each
 * device would see the other's file as "changed" on every sync and upload
 * again forever.
 */
export function mergeTable(mine: TableRows, theirs: TableRows): TableRows {
  const byId = new Map<string, Row>();

  for (const row of mine) {
    const id = row[ID_COLUMN];
    if (typeof id !== 'string') continue;
    byId.set(id, row);
  }

  for (const row of theirs) {
    const id = row[ID_COLUMN];
    if (typeof id !== 'string') continue;

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, row);
      continue;
    }

    /*
     * A tie goes to the row already held.
     *
     * Two edits in the same millisecond are indistinguishable, and picking
     * arbitrarily would make the merge non-deterministic: the two phones would
     * disagree about the result and keep overwriting each other. Preferring
     * `mine` is stable because the caller always merges in the same direction.
     */
    if (rowTime(row) > rowTime(existing)) byId.set(id, row);
  }

  return [...byId.values()].sort((a, b) =>
    String(a[ID_COLUMN]).localeCompare(String(b[ID_COLUMN])),
  );
}

/** Every table name appearing in either snapshot. */
export function mergedTableNames(
  mine: Readonly<Record<string, TableRows>>,
  theirs: Readonly<Record<string, TableRows>>,
): string[] {
  return [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].sort();
}

/**
 * Merge whole table sets.
 *
 * A table present on one side only is taken wholesale — that is a device
 * running a newer version with a table the other has not got yet, and dropping
 * it would delete the feature's data every time the older phone synced.
 */
export function mergeTables(
  mine: Readonly<Record<string, TableRows>>,
  theirs: Readonly<Record<string, TableRows>>,
): Record<string, TableRows> {
  const out: Record<string, TableRows> = {};
  for (const table of mergedTableNames(mine, theirs)) {
    out[table] = mergeTable(mine[table] ?? [], theirs[table] ?? []);
  }
  return out;
}

/**
 * How long a tombstone is kept before the row is finally dropped.
 *
 * 90 days. A tombstone exists so a delete reaches every device; once every
 * device has certainly seen it, the row is dead weight in the file. The window
 * has to exceed the longest a phone might plausibly stay offline — a holiday,
 * a spare handset in a drawer — because dropping the tombstone while a stale
 * device still holds the live row lets that device resurrect it.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Drop tombstones old enough that every device has seen them.
 *
 * Applied only when WRITING the shared file, never when reading: a device that
 * pruned on read would resurrect rows the file still carries a tombstone for.
 */
export function pruneTombstones(
  tables: Readonly<Record<string, TableRows>>,
  now = Date.now(),
): Record<string, TableRows> {
  const out: Record<string, TableRows> = {};
  for (const [table, rows] of Object.entries(tables)) {
    out[table] = rows.filter(
      (row) => !isDeleted(row) || now - rowTime(row) < TOMBSTONE_TTL_MS,
    );
  }
  return out;
}

/** What a merge changed, for the UI to report honestly. */
export interface MergeReport {
  /** Rows that came from the other device. */
  pulled: number;
  /** Rows this device holds that the other did not. */
  pushed: number;
  /** Rows present on both, where one version was discarded. */
  conflicts: number;
}

/**
 * Describe a merge without performing it.
 *
 * Counted separately from `mergeTables` so the caller can show "12 changes from
 * her phone" before writing anything, and so the numbers cannot drift from the
 * merge itself — both walk the same comparison.
 */
export function describeMerge(
  mine: Readonly<Record<string, TableRows>>,
  theirs: Readonly<Record<string, TableRows>>,
): MergeReport {
  let pulled = 0;
  let pushed = 0;
  let conflicts = 0;

  for (const table of mergedTableNames(mine, theirs)) {
    const mineById = new Map<string, Row>();
    for (const row of mine[table] ?? []) {
      const id = row[ID_COLUMN];
      if (typeof id === 'string') mineById.set(id, row);
    }

    const seen = new Set<string>();
    for (const row of theirs[table] ?? []) {
      const id = row[ID_COLUMN];
      if (typeof id !== 'string') continue;
      seen.add(id);

      const existing = mineById.get(id);
      if (!existing) {
        pulled++;
        continue;
      }
      if (rowTime(row) === rowTime(existing)) continue;
      conflicts++;
      if (rowTime(row) > rowTime(existing)) pulled++;
    }

    for (const id of mineById.keys()) {
      if (!seen.has(id)) pushed++;
    }
  }

  return { pulled, pushed, conflicts };
}
