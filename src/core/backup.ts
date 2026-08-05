/**
 * The backup snapshot: the whole board as one portable JSON document.
 *
 * ## What this is for
 *
 * Everything lives in one local SQLite file (see db/client.ts), which means a
 * lost, wiped or replaced phone loses every transaction the user has ever
 * recorded. There is no server copy, because the shared catalog deliberately
 * stores nothing personal. So a backup is the ONLY path off the device.
 *
 * ## Why a JSON document rather than the .db file
 *
 * Copying the SQLite file would be simpler and is the wrong choice:
 *
 *   - it is opaque, so a user cannot inspect what left their phone;
 *   - it is version-locked to the exact schema that wrote it, so a restore onto
 *     a newer build depends on the migration path still handling a file that
 *     may be several versions old;
 *   - it carries WAL/SHM sidecars, and a snapshot taken without them can be
 *     silently mid-transaction.
 *
 * A declared, versioned document is inspectable, diffable, and can be migrated
 * on READ — which is what makes a two-year-old backup restorable at all.
 *
 * ## What is deliberately excluded
 *
 * `sms_inbox` is not backed up. It is a queue of unreviewed bank messages, not
 * user data: restoring it would re-present drafts the user already resolved on
 * their old phone, and it holds raw message text, which is the most sensitive
 * thing this app touches and has no business in a cloud file.
 *
 * Everything here is pure — no database, no network — so the format is fully
 * testable and the same functions serve export, cloud sync and any future
 * transport.
 */

/**
 * Snapshot format version.
 *
 * Bumped whenever the SHAPE changes in a way a reader must know about. Adding a
 * table or a nullable column does not require a bump (an older reader ignores
 * what it does not know, a newer reader defaults what is absent); renaming or
 * removing one does.
 */
export const SNAPSHOT_VERSION = 1;

/**
 * Tables carried in a snapshot, in DEPENDENCY ORDER.
 *
 * Restore inserts in this order and deletes in reverse, so a foreign key never
 * points at a row that has not been written yet. Getting this wrong produces a
 * restore that fails halfway and leaves a half-populated board, which is worse
 * than not restoring at all.
 *
 * `sms_inbox` is absent on purpose — see the module comment.
 */
export const SNAPSHOT_TABLES = [
  // No dependencies.
  'settings',
  'cards',
  'houses',
  'loans',
  'vehicles',
  // Reference the above.
  'categories',
  'incomes',
  'merchant_rules',
  // Reference categories.
  'subcategories',
  // Reference subcategories.
  'transactions',
  'subcategory_states',
  'category_states',
  'fundings',
  'fuel_entries',
  'vehicle_services',
  // References vehicle_services.
  'service_items',
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/**
 * How much of a backup to restore.
 *
 * `setup` restores the SHAPE of someone's finances — their accounts, houses,
 * categories, budget lines, loans, vehicles and learned merchant rules — while
 * leaving out every record of money actually moving. `everything` restores the
 * history too.
 *
 * The distinction is worth a choice because the two are wanted for genuinely
 * different reasons:
 *
 *   - restoring a lost phone wants EVERYTHING, obviously;
 *   - starting a fresh year, handing the setup to a family member, or recovering
 *     from a board that got into a mess wants the structure WITHOUT inheriting
 *     someone else's (or last year's) transactions, which would make every total
 *     on the new board wrong from the first day.
 *
 * Without the split, the only way to reuse a carefully-built plan is to rebuild
 * it by hand.
 */
export type RestoreScope = 'setup' | 'everything';

/**
 * Tables holding RECORDS OF MONEY MOVING, as opposed to the structure it moves
 * through.
 *
 * These are what a `setup` restore omits. The test for membership is "would
 * carrying this row into a fresh board make a figure on it wrong?" — a
 * transaction would, a category would not.
 *
 * `fundings`, `subcategory_states` and `category_states` are here because they
 * are per-PERIOD facts: "this bill was paid in August". Carrying them over
 * marks bills paid that nobody has paid on the new board.
 *
 * `fuel_entries` and `vehicle_services` are records of events with amounts and
 * odometer readings attached, so they belong with the history — but `vehicles`
 * itself is structure and is kept.
 */
export const HISTORY_TABLES: readonly SnapshotTable[] = [
  'transactions',
  'subcategory_states',
  'category_states',
  'fundings',
  'fuel_entries',
  'vehicle_services',
  'service_items',
];

/** Whether a table survives a `setup`-only restore. */
export function tableInScope(table: string, scope: RestoreScope): boolean {
  if (scope === 'everything') return true;
  return !HISTORY_TABLES.includes(table as SnapshotTable);
}

/**
 * The tables a scope will actually write.
 *
 * Order is preserved from `SNAPSHOT_TABLES`, so the dependency ordering a
 * restore relies on still holds after filtering.
 */
export function tablesForScope(scope: RestoreScope): SnapshotTable[] {
  return SNAPSHOT_TABLES.filter((table) => tableInScope(table, scope));
}

/** What each scope would bring back, for the confirmation the user reads. */
export function describeScope(snapshot: Snapshot, scope: RestoreScope): string {
  const count = (table: string) => snapshot.counts?.[table] ?? 0;

  const structure = [
    [count('cards'), 'account'],
    [count('houses'), 'house'],
    [count('subcategories'), 'bill'],
    [count('loans'), 'loan'],
  ] as const;

  const parts = structure
    .filter(([n]) => n > 0)
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? '' : 's'}`);

  if (scope === 'everything') {
    const transactions = count('transactions');
    parts.push(`${transactions} transaction${transactions === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'nothing';
}

/** One table's rows, exactly as read from SQLite. */
export type TableRows = Record<string, unknown>[];

export interface Snapshot {
  /** Format version — see `SNAPSHOT_VERSION`. */
  version: number;
  /** ISO timestamp the snapshot was taken. Shown in the restore list. */
  createdAt: string;
  /** App version that wrote it, for diagnosing a bad restore. */
  appVersion: string;
  /**
   * Row counts per table, written at export time.
   *
   * Redundant with the data, and that is the point: it is the integrity check.
   * A truncated upload or a partial download yields tables shorter than their
   * declared counts, which `validateSnapshot` catches BEFORE anything is
   * written over the user's live board.
   */
  counts: Record<string, number>;
  /** The rows themselves, keyed by table name. */
  tables: Record<string, TableRows>;
}

/** Everything wrong with a snapshot, or an empty list when it is sound. */
export interface ValidationResult {
  ok: boolean;
  problems: string[];
  /** Total rows across every table — the headline figure for the UI. */
  rowCount: number;
}

/**
 * Build a snapshot from raw table reads.
 *
 * Takes the rows rather than fetching them, so this stays pure and the DB layer
 * owns querying. Tables absent from `tables` are written as empty arrays rather
 * than omitted, so a reader never has to distinguish "no rows" from "this
 * version did not have that table".
 */
export function buildSnapshot(
  tables: Partial<Record<SnapshotTable, TableRows>>,
  meta: { appVersion: string; now?: Date },
): Snapshot {
  const filled: Record<string, TableRows> = {};
  const counts: Record<string, number> = {};

  for (const table of SNAPSHOT_TABLES) {
    const rows = tables[table] ?? [];
    filled[table] = rows;
    counts[table] = rows.length;
  }

  return {
    version: SNAPSHOT_VERSION,
    createdAt: (meta.now ?? new Date()).toISOString(),
    appVersion: meta.appVersion,
    counts,
    tables: filled,
  };
}

/**
 * Check a snapshot before restoring from it.
 *
 * Runs BEFORE the live board is touched, because restore is destructive: it
 * clears the existing tables and writes the snapshot's rows in their place. A
 * corrupt file discovered halfway through leaves the user with neither their
 * old data nor a complete restore, so every check that can be made up front is
 * made here.
 *
 * Deliberately strict about structure and forgiving about content: an unknown
 * table is a warning-level problem (a newer app wrote it), while a declared
 * count that disagrees with the rows present means the file is damaged.
 */
export function validateSnapshot(input: unknown): ValidationResult {
  const problems: string[] = [];

  if (input === null || typeof input !== 'object') {
    return { ok: false, problems: ['Not a backup file.'], rowCount: 0 };
  }

  const snapshot = input as Partial<Snapshot>;

  if (typeof snapshot.version !== 'number') {
    problems.push('Missing format version.');
  } else if (snapshot.version > SNAPSHOT_VERSION) {
    /*
     * A NEWER file than this build understands.
     *
     * Refused rather than partially read: the unknown parts are exactly the
     * ones that would be silently dropped, and a restore that quietly discards
     * data is the worst outcome available. Updating the app is the fix.
     */
    problems.push(
      `This backup was made by a newer version of the app (format ${snapshot.version}). Update the app, then restore.`,
    );
  }

  if (snapshot.tables === null || typeof snapshot.tables !== 'object') {
    return { ok: false, problems: [...problems, 'Backup contains no data.'], rowCount: 0 };
  }

  let rowCount = 0;

  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (!Array.isArray(rows)) {
      problems.push(`Table "${table}" is not a list of rows.`);
      continue;
    }

    rowCount += rows.length;

    // The integrity check — see `counts`.
    const declared = snapshot.counts?.[table];
    if (typeof declared === 'number' && declared !== rows.length) {
      problems.push(
        `Table "${table}" is incomplete: expected ${declared} rows, found ${rows.length}.`,
      );
    }

    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        problems.push(`Table "${table}" contains a row that is not an object.`);
        break;
      }
    }
  }

  return { ok: problems.length === 0, problems, rowCount };
}

/** A one-line summary of what a snapshot holds, for the restore list. */
export function describeSnapshot(snapshot: Snapshot): string {
  const transactions = snapshot.counts?.transactions ?? 0;
  const subcategories = snapshot.counts?.subcategories ?? 0;

  const parts = [
    `${subcategories} bill${subcategories === 1 ? '' : 's'}`,
    `${transactions} transaction${transactions === 1 ? '' : 's'}`,
  ];

  return parts.join(' · ');
}

/**
 * Serialise for upload.
 *
 * Pretty-printed deliberately. The file lands in the user's own Drive, and
 * being able to open it and see recognisable category names is what makes a
 * backup trustworthy rather than an opaque blob. The size cost is irrelevant at
 * the scale of a personal budget — a few hundred KB at most.
 */
export function serialiseSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** Parse a downloaded file. Returns null when it is not JSON at all. */
export function parseSnapshot(contents: string): Snapshot | null {
  try {
    const parsed = JSON.parse(contents);
    return parsed && typeof parsed === 'object' ? (parsed as Snapshot) : null;
  } catch {
    return null;
  }
}

/**
 * The filename a snapshot is stored under.
 *
 * Timestamped so successive backups do not overwrite each other — a backup that
 * replaces the only good copy with a corrupt one is not a backup. Sortable by
 * name, which is what lets the restore list show newest-first without parsing
 * every file.
 */
export function snapshotFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `money-manager-${stamp}.json`;
}

/** Whether a filename is one of ours, for filtering the Drive folder listing. */
export function isSnapshotFilename(name: string): boolean {
  return /^money-manager-.*\.json$/i.test(name);
}
