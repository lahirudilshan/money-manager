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
 * ## The Smart Detect queue is OPT-IN
 *
 * `sms_inbox` was excluded outright for two reasons: restoring it would
 * re-present drafts already resolved on the old phone, and it holds raw bank
 * message text — the most sensitive thing this app touches.
 *
 * Both still hold, but excluding it silently loses real work: a reinstall threw
 * away every message still awaiting review, and nothing else on the device kept
 * a copy. So it is a part the user ticks, defaulting OFF for a backup (the
 * sensitive-text argument) and offered on restore only when the file has one.
 * The re-presenting problem is answered by only carrying rows still PENDING —
 * a confirmed or dismissed message is a decision already made.
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
 * `sms_inbox` sits LAST and is opt-in — see the `sms` part in `BACKUP_PARTS`.
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
  /*
   * AFTER `transactions`, which is a real dependency and not just tidiness: a
   * split row's `transaction_id` is a foreign key, so restoring the parts
   * before their parent payment fails the constraint and the allocation is
   * lost — leaving a restored 5,000 shop counted entirely against whichever
   * single line the transaction itself names.
   */
  'transaction_splits',
  'subcategory_states',
  'category_states',
  'fundings',
  'fuel_entries',
  'vehicle_services',
  // References vehicle_services.
  'service_items',
  /*
   * Health records — see the `health` part below.
   *
   * Ordered people -> visits -> the rest: a medicine points at the visit that
   * prescribed it, and documents and readings may also reference a visit.
   * Restoring out of this order fails on a foreign key.
   */
  'health_people',
  'health_visits',
  'health_medicines',
  'health_documents',
  'health_readings',
  /*
   * The Smart Detect queue — messages waiting for review.
   *
   * Last in the list because nothing references it, and it is the only table a
   * user might reasonably want to leave OUT (see the `sms` part below): it
   * carries raw bank message text, which is the most sensitive thing this app
   * holds.
   */
  'sms_inbox',
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
  /*
   * With `transactions`, necessarily.
   *
   * A split is part of a payment, so it is history by the same test as its
   * parent — but it is listed here for a harder reason than symmetry: a
   * structure-only restore SKIPS `transactions`, and writing the parts without
   * them would violate the `transaction_id` foreign key. Every split row would
   * be orphaned or rejected, on a path the user chose precisely to avoid
   * carrying old money into a fresh board.
   */
  'transaction_splits',
  'subcategory_states',
  'category_states',
  'fundings',
  'fuel_entries',
  'vehicle_services',
  'service_items',
  /*
   * Health EVENTS are history; health PEOPLE and their medicine list are not.
   *
   * Same test as everywhere else here — "would carrying this into a fresh board
   * make a figure on it wrong?". A visit last March would; the fact that Amma
   * exists and is on Metformin would not, and losing that on a setup-only
   * restore would mean retyping the whole family.
   */
  'health_visits',
  'health_documents',
  'health_readings',
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
   * The user's own name for this backup — "before 2027 reset", "for Amma".
   *
   * A list of timestamps is unusable once there are more than about three:
   * every row looks the same and the only way to tell them apart is to restore
   * one and see. A label is the difference between a backup someone keeps and
   * one they are afraid to touch. Optional — an unnamed backup still lists by
   * date, exactly as before.
   */
  label?: string;
  /**
   * Which parts this snapshot actually holds.
   *
   * Written so the restore screen can say "this one has no transactions"
   * BEFORE the user restores it, rather than presenting a partial backup as if
   * it were complete. Absent on snapshots written before selective backup, and
   * read as "everything" for those.
   */
  parts?: BackupPartKey[];
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
  meta: { appVersion: string; now?: Date; label?: string; parts?: BackupPartKey[] },
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
    ...(meta.label ? { label: meta.label } : {}),
    ...(meta.parts ? { parts: meta.parts } : {}),
    counts,
    tables: filled,
  };
}

/**
 * Bring a stored value written by an OLDER app onto its current spelling.
 *
 * The `unplanned` cadence was renamed to `ongoing`, and a backup holds raw
 * table rows — so every snapshot taken before the rename still carries the old
 * word. Restoring one verbatim would put a value into the frequency column that
 * no longer means anything to the code reading it: the line would stop being
 * recognised as ongoing, and would render as a dated bill it never was.
 *
 * Lives here, with the format, rather than beside the INSERT that uses it:
 * reading an old file is a property of the FORMAT, and keeping it pure is what
 * lets it be tested without a database.
 *
 * Deliberately keyed on table AND column. `frequency` is a common enough column
 * name that a blanket value rewrite would eventually corrupt an unrelated one.
 */
export function migrateValue(table: string, column: string, value: unknown): unknown {
  if (table === 'subcategories' && column === 'frequency' && value === 'unplanned') {
    return 'ongoing';
  }
  return value;
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

/**
 * A filename stamp as a real ISO instant, for arithmetic rather than display.
 *
 * The stamp is UTC — `snapshotFilename` builds it from `toISOString()` — but
 * carries no `Z`, so comparing it as text against Drive's `modifiedTime` would
 * order the two sources by different clocks. In a merged list that means the
 * newest copy is not reliably on top. Returns the input untouched when it is
 * already an ISO string, so Drive rows pass straight through.
 */
export function stampToIso(stamp: string): string {
  return stamp.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/, '$1-$2-$3T$4:$5:$6Z');
}

/**
 * The exact moment, for anyone who wants certainty rather than a rough age.
 *
 * This is what tells two backups sharing a NAME apart. A label is free text and
 * the same one gets reused — "before reset" on two different days is ordinary —
 * so once the name takes a row's title, the wall-clock moment is the only thing
 * left that distinguishes them. A relative age does not: two backups an hour
 * apart are both "3 hours ago".
 */
export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Turn a filename stamp ("2026-08-04T12-00-00") into something readable.
 *
 * The stamp is UTC, so the `Z` has to go back on before parsing. Without it
 * `new Date` reads the string as LOCAL time, and every backup in the list showed
 * a time off by the whole timezone offset: a backup taken at 17:30 in Colombo
 * listed as 12:00, five and a half hours before it happened. The half-hour
 * offset is what makes this unmistakable rather than merely suspicious.
 */
export function readableStamp(stamp: string): string {
  const date = new Date(stampToIso(stamp));
  return Number.isNaN(date.getTime()) ? stamp : absoluteTime(date.toISOString());
}

/**
 * How a backup is named in a list: the user's own name, then when it was taken.
 *
 * A label is free text, and nothing stops the same one being used twice —
 * "before reset" on two different days is the ordinary case, not a corner one.
 * A title that is only the label is therefore not unique, and two such rows are
 * indistinguishable on the one screen where picking the wrong copy overwrites a
 * board. Appending the moment makes every title unique by construction, which
 * is better than rejecting a duplicate name or silently renaming it: the user
 * gets to reuse the name that means something to them, and the list still tells
 * the copies apart.
 *
 * An unnamed backup is just the timestamp, exactly as it always was.
 */
export function titleFor(label: string | undefined, stamp: string): string {
  const name = label?.trim();
  const when = readableStamp(stamp);
  return name ? `${name} · ${when}` : when;
}

/** Whether a filename is one of ours, for filtering the Drive folder listing. */
export function isSnapshotFilename(name: string): boolean {
  return /^money-manager-.*\.json$/i.test(name);
}

/**
 * The selectable PARTS of a backup, as a user thinks about them.
 *
 * The `setup` / `everything` split was the right first cut but too coarse: it
 * could not express "my accounts and categories, but not last year's
 * transactions", which is exactly what someone starting a fresh year or handing
 * a plan to a family member wants.
 *
 * Each part names a group of tables and says what it is FOR, because
 * "subcategory_states" means nothing to anyone. Order is the order they are
 * offered in — structure first, history last, matching how destructive each is
 * to bring back.
 */
export interface BackupPart {
  key: BackupPartKey;
  label: string;
  hint: string;
  tables: readonly SnapshotTable[];
  /**
   * Whether unticking it is allowed.
   *
   * `settings` and `cards` underpin everything else — a restore without the
   * accounts a bill is funded from leaves dangling references — so they travel
   * with any selection rather than being offered as a choice that produces a
   * broken board.
   */
  required?: boolean;
  /**
   * Whether this part carries something that should never leave the phone by
   * default.
   *
   * Only `sms` so far: the review queue holds raw bank message text. It is
   * still offered — losing it on a reinstall is real data loss — but a user has
   * to tick it deliberately, so a cloud upload never carries their SMS because
   * nobody thought about it.
   */
  sensitive?: boolean;
}

export type BackupPartKey =
  | 'core'
  | 'plan'
  | 'houses'
  | 'loans'
  | 'vehicles'
  | 'rules'
  | 'history'
  | 'health'
  | 'sms';

export const BACKUP_PARTS: readonly BackupPart[] = [
  {
    key: 'core',
    label: 'Accounts & settings',
    hint: 'Your banks, cards and app preferences',
    tables: ['settings', 'cards'],
    required: true,
  },
  {
    key: 'plan',
    label: 'Categories & bills',
    hint: 'The plan itself — what you budget for',
    tables: ['categories', 'subcategories', 'incomes'],
  },
  { key: 'houses', label: 'Houses', hint: 'Properties whose bills you track', tables: ['houses'] },
  { key: 'loans', label: 'Loans', hint: 'Loan records and their schedules', tables: ['loans'] },
  {
    key: 'vehicles',
    label: 'Vehicles',
    hint: 'Vehicles and their service records',
    tables: ['vehicles', 'vehicle_services', 'service_items'],
  },
  {
    key: 'rules',
    label: 'Learned merchants',
    hint: 'What the app has learned about your shops',
    tables: ['merchant_rules'],
  },
  {
    key: 'history',
    label: 'Transactions & history',
    hint: 'Every payment recorded, month by month',
    tables: ['transactions', 'subcategory_states', 'category_states', 'fundings', 'fuel_entries'],
  },
  /*
   * Health records — `sensitive`, so a backup never carries a family's medical
   * history because a default said so.
   *
   * The strictest case for that flag in the app. Bank message text is private;
   * a record of who takes what medication, and what they were diagnosed with,
   * is the kind of thing that should only leave the phone when someone has
   * deliberately said yes — and this app's backups can go to Google Drive.
   *
   * All six tables travel together. Splitting "people" from their records would
   * let someone restore a timeline whose person rows are missing, which is not
   * a state any screen here can render.
   */
  {
    key: 'health',
    label: 'Health records',
    hint: 'Visits, prescriptions, reports and readings',
    tables: [
      'health_people',
      'health_visits',
      'health_medicines',
      'health_documents',
      'health_readings',
    ],
    sensitive: true,
  },
  {
    key: 'sms',
    label: 'Messages awaiting review',
    hint: 'Smart Detect rows you have not confirmed yet',
    tables: ['sms_inbox'],
    sensitive: true,
  },
];

/**
 * Every part there is — what a RESTORE offers, and what an old backup implies.
 *
 * Not the backup default: see `DEFAULT_BACKUP_PARTS`.
 */
export const ALL_PARTS: BackupPartKey[] = BACKUP_PARTS.map((part) => part.key);

/**
 * What a new backup ticks by default: everything EXCEPT the sensitive parts.
 *
 * Raw bank message text should never leave the phone because a default said so
 * — that is a decision the user makes deliberately, per backup. Everything else
 * defaults on, since leaving data out is the odd case.
 */
export const DEFAULT_BACKUP_PARTS: BackupPartKey[] = BACKUP_PARTS.filter(
  (part) => !part.sensitive,
).map((part) => part.key);

/**
 * Structure only — the "reuse this plan" selection.
 *
 * Excludes the review queue as well as history: someone starting a fresh board
 * from an old plan wants the shape of their finances, not a list of last
 * month's unconfirmed bank messages to work through.
 */
export const SETUP_PARTS: BackupPartKey[] = BACKUP_PARTS.filter(
  (part) => part.key !== 'history' && part.key !== 'sms',
).map((part) => part.key);

/**
 * The tables a selection covers.
 *
 * Required parts are folded in whether or not they were ticked, so a selection
 * can never produce a board whose bills point at accounts that were not
 * restored. Order follows `SNAPSHOT_TABLES` so the dependency ordering a
 * restore relies on still holds.
 */
export function partsOf(snapshot: Snapshot): BackupPartKey[] {
  /*
   * Snapshots written before selective backup carry no `parts` field. They
   * always held everything, so reading them as `ALL_PARTS` is accurate — the
   * alternative, treating an absent field as "nothing", would make every old
   * backup look empty and unrestorable.
   */
  return snapshot.parts ?? ALL_PARTS;
}

/** One line of a backup's contents: a part, and how much of it is in there. */
export interface SnapshotPartSummary {
  key: BackupPartKey;
  label: string;
  /** Rows across every table in this part. */
  count: number;
  /** Whether the file actually carries this part at all. */
  included: boolean;
  /**
   * The individual tables behind the total, each in the user's words.
   *
   * A part is a bundle — "Transactions & history" is five tables — so its
   * single number hides what it is made of. A user deciding whether to restore
   * it can reasonably ask "142 of what?", and the answer is already in the
   * file's own counts.
   */
  tables: { label: string; count: number }[];
}

/**
 * Plain-language names for the tables inside a part.
 *
 * Nobody deciding what to restore can reason about `subcategory_states`. Any
 * table missing here falls back to its own name with the underscores removed,
 * so a new table is readable before anyone remembers to name it.
 */
const TABLE_LABELS: Record<string, string> = {
  settings: 'Preferences',
  cards: 'Accounts & cards',
  categories: 'Category groups',
  subcategories: 'Bills & lines',
  incomes: 'Income sources',
  houses: 'Houses',
  loans: 'Loans',
  vehicles: 'Vehicles',
  vehicle_services: 'Service visits',
  service_items: 'Service items',
  merchant_rules: 'Learned merchants',
  transactions: 'Transactions',
  subcategory_states: 'Monthly bill states',
  category_states: 'Monthly group states',
  fundings: 'Funding moves',
  fuel_entries: 'Fuel fill-ups',
  health_people: 'People',
  health_medicines: 'Medicines',
  health_visits: 'Doctor visits',
  health_documents: 'Prescriptions & reports',
  health_readings: 'Readings',
  sms_inbox: 'Messages awaiting review',
};

function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table.replace(/_/g, ' ');
}

/**
 * What a backup file holds, part by part.
 *
 * `describeSnapshot` answers the same question in six words ("10 bills · 142
 * transactions"), which is right for a list row but not enough to choose by:
 * restoring REPLACES the board, and two files a day apart look identical at
 * that resolution. This reports every part with its real row count, so the
 * decision is made against what is actually inside rather than a timestamp.
 *
 * Parts the file does NOT carry are still returned, marked `included: false`.
 * A selective backup's omissions are the most important thing about it — "this
 * one has no transactions" is exactly what a user needs to see before they
 * restore it over a board that does.
 */
export function summariseSnapshot(snapshot: Snapshot): SnapshotPartSummary[] {
  const included = new Set(partsOf(snapshot));

  return BACKUP_PARTS.map((part) => ({
    key: part.key,
    label: part.label,
    count: part.tables.reduce((total, table) => total + (snapshot.counts?.[table] ?? 0), 0),
    // `required` parts travel with every selection, so they are always present.
    included: part.required === true || included.has(part.key),
    tables: part.tables.map((table) => ({
      label: tableLabel(table),
      count: snapshot.counts?.[table] ?? 0,
    })),
  }));
}

export function tablesForParts(parts: readonly BackupPartKey[]): SnapshotTable[] {
  const wanted = new Set<SnapshotTable>();

  for (const part of BACKUP_PARTS) {
    if (!part.required && !parts.includes(part.key)) continue;
    for (const table of part.tables) wanted.add(table);
  }

  return SNAPSHOT_TABLES.filter((table) => wanted.has(table));
}

/** What a selection would bring back, in the user's terms. */
export function describeParts(snapshot: Snapshot, parts: readonly BackupPartKey[]): string {
  const count = (table: string) => snapshot.counts?.[table] ?? 0;
  const has = (key: BackupPartKey) => parts.includes(key);

  const pieces: string[] = [];

  if (count('cards') > 0) pieces.push(plural(count('cards'), 'account'));
  if (has('plan') && count('subcategories') > 0) pieces.push(plural(count('subcategories'), 'bill'));
  if (has('houses') && count('houses') > 0) pieces.push(plural(count('houses'), 'house'));
  if (has('loans') && count('loans') > 0) pieces.push(plural(count('loans'), 'loan'));
  if (has('history') && count('transactions') > 0) {
    pieces.push(plural(count('transactions'), 'transaction'));
  }

  return pieces.length > 0 ? pieces.join(' · ') : 'nothing';
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
