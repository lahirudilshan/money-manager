import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

const DATABASE_NAME = 'money-manager.db';

/**
 * Single shared connection. expo-sqlite handles concurrency internally, and
 * opening the database twice risks divergent WAL state.
 */
const expoDb = SQLite.openDatabaseSync(DATABASE_NAME, {
  enableChangeListener: true,
});

export const db = drizzle(expoDb, { schema });
export type Database = typeof db;
export { expoDb, DATABASE_NAME };

/**
 * Schema is applied as raw `IF NOT EXISTS` DDL rather than generated migration
 * files: for a local-only app this removes a codegen step while staying
 * explicit. `user_version` gates destructive upgrades.
 */
const SCHEMA_VERSION = 4;

const DDL = [
  `CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'bank',
    bank_id TEXT,
    bank_name TEXT,
    last4 TEXT,
    color TEXT NOT NULL DEFAULT '#6366F1',
    icon TEXT NOT NULL DEFAULT 'card-outline',
    target_minor INTEGER,
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'personal',
    bank_id TEXT,
    principal_minor INTEGER NOT NULL,
    annual_rate_pct REAL NOT NULL,
    term_months INTEGER NOT NULL,
    start_date INTEGER NOT NULL,
    color TEXT NOT NULL DEFAULT '#F97316',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  // The primary object — funded as a unit, owns its own card/due day (see schema.ts).
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    color TEXT NOT NULL DEFAULT '#6366F1',
    icon TEXT NOT NULL DEFAULT 'albums-outline',
    due_day INTEGER NOT NULL DEFAULT 1,
    default_frequency TEXT NOT NULL DEFAULT 'monthly',
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  // The real budget line — the board's leaf.
  `CREATE TABLE IF NOT EXISTS subcategories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'expense',
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    color TEXT NOT NULL DEFAULT '#6366F1',
    icon TEXT NOT NULL DEFAULT 'pricetag-outline',
    planned_minor INTEGER NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'monthly',
    due_day INTEGER,
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    loan_id TEXT REFERENCES loans(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS subcategory_states (
    id TEXT PRIMARY KEY NOT NULL,
    subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    actual_minor INTEGER,
    transferred_at INTEGER,
    completed_at INTEGER,
    note TEXT,
    image_uri TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS category_states (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    transferred_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS fundings (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    period TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    date INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS incomes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    foreign_amount REAL,
    foreign_rate REAL,
    icon TEXT NOT NULL DEFAULT 'cash-outline',
    color TEXT NOT NULL DEFAULT '#0F8A4D',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS categories_card_idx ON categories(card_id)`,
  `CREATE INDEX IF NOT EXISTS subcategories_category_idx ON subcategories(category_id)`,
  `CREATE INDEX IF NOT EXISTS subcategory_states_period_idx ON subcategory_states(period)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS subcategory_states_lookup_idx
     ON subcategory_states(subcategory_id, period)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS category_states_lookup_idx
     ON category_states(category_id, period)`,
  `CREATE INDEX IF NOT EXISTS fundings_lookup_idx ON fundings(category_id, period)`,
];

/**
 * Only 3 of the previously-flat categories fan out into a shared parent when
 * migrating to the category/subcategory hierarchy — every other seeded item
 * stays a 1:1 wrapper (see step 5 in `migrateV2ToV3`). Matches are scoped by
 * name *and* original group name so a same-named item elsewhere is untouched.
 */
const V3_REGROUPINGS: {
  id: string;
  name: string;
  icon: string;
  groupName: string;
  memberNames: string[];
}[] = [
  {
    id: 'cat_housing',
    name: 'Housing',
    icon: 'home-outline',
    groupName: 'Home Expenses',
    memberNames: ['Weligama Home', 'Kelaniya Home', 'Rent'],
  },
  {
    id: 'cat_utilities',
    name: 'Utilities',
    icon: 'flash-outline',
    groupName: 'Home Expenses',
    memberNames: ['Electricity', 'Water'],
  },
  {
    id: 'cat_running_costs',
    name: 'Running Costs',
    icon: 'construct-outline',
    groupName: 'Vehicle Plan',
    memberNames: ['Insurance', 'Vehicle Fuel', 'Service'],
  },
];

/**
 * v2's `categories` table was the leaf/budget line; v3 splits that into a
 * label (`categories`) above a real leaf (`subcategories`). This preserves
 * every row's id (so `category_states` history keeps resolving to the right
 * line) by renaming the old tables aside, rebuilding the new shapes, copying
 * data across with a deterministic 1:1 wrapper category per old row, then
 * reparenting the handful of items that actually share a parent in the real
 * plan. Safe create-new-table + copy + drop, since SQLite's ALTER TABLE
 * cannot add a NOT NULL FK column to an existing table with data in it.
 */
function migrateV2ToV3(): void {
  const hasCategories = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='categories'`,
  );
  if (!hasCategories) return;

  const categoryCount = (
    expoDb.getFirstSync(`SELECT COUNT(*) as count FROM categories`) as { count: number } | null
  )?.count ?? 0;
  if (categoryCount === 0) return;

  expoDb.execSync('PRAGMA foreign_keys = OFF;');
  expoDb.execSync('BEGIN IMMEDIATE;');

  try {
    expoDb.execSync('ALTER TABLE categories RENAME TO subcategories_old;');
    expoDb.execSync('ALTER TABLE category_states RENAME TO subcategory_states_old;');

    // New label-only `categories` shape.
    expoDb.execSync(`CREATE TABLE categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      icon TEXT NOT NULL DEFAULT 'pricetag-outline',
      color TEXT NOT NULL DEFAULT '#6366F1',
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`);

    // New leaf `subcategories` shape.
    expoDb.execSync(`CREATE TABLE subcategories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      color TEXT NOT NULL DEFAULT '#6366F1',
      icon TEXT NOT NULL DEFAULT 'pricetag-outline',
      planned_minor INTEGER NOT NULL DEFAULT 0,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      due_day INTEGER,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      loan_id TEXT REFERENCES loans(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`);

    // Every old category row gets a deterministic 1:1 wrapper category.
    expoDb.execSync(`
      INSERT INTO categories (id, name, group_id, icon, color, card_id, sort_order, archived_at, created_at, updated_at)
      SELECT 'cat_' || id, name, group_id, icon, color, NULL, sort_order, archived_at, created_at, updated_at
      FROM subcategories_old;
    `);

    // Copy every old row into the new leaf table, preserving its id.
    expoDb.execSync(`
      INSERT INTO subcategories (id, name, type, category_id, color, icon, planned_minor, frequency, due_day, card_id, loan_id, sort_order, archived_at, created_at, updated_at)
      SELECT id, name, type, 'cat_' || id, color, icon, planned_minor, 'monthly', NULL, NULL, loan_id, sort_order, archived_at, created_at, updated_at
      FROM subcategories_old;
    `);

    // Pure column rename — subcategory ids are unchanged from the step above.
    expoDb.execSync(`CREATE TABLE subcategory_states (
      id TEXT PRIMARY KEY NOT NULL,
      subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      actual_minor INTEGER,
      transferred_at INTEGER,
      completed_at INTEGER,
      note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`);
    expoDb.execSync(`
      INSERT INTO subcategory_states (id, subcategory_id, period, status, actual_minor, transferred_at, completed_at, note, created_at, updated_at)
      SELECT id, category_id, period, status, actual_minor, transferred_at, completed_at, note, created_at, updated_at
      FROM subcategory_states_old;
    `);

    // Reparent the handful of items that actually share a category in the real plan.
    for (const group of V3_REGROUPINGS) {
      const namesList = group.memberNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');

      expoDb.execSync(`
        INSERT INTO categories (id, name, group_id, icon, color, card_id, sort_order, archived_at, created_at, updated_at)
        VALUES (
          '${group.id}', '${group.name.replace(/'/g, "''")}',
          (SELECT id FROM groups WHERE name = '${group.groupName.replace(/'/g, "''")}'),
          '${group.icon}', '#6366F1', NULL, 0, NULL,
          (unixepoch() * 1000), (unixepoch() * 1000)
        );
      `);

      const caseClauses = group.memberNames
        .map((n, i) => `WHEN '${n.replace(/'/g, "''")}' THEN ${i}`)
        .join(' ');

      expoDb.execSync(`
        UPDATE subcategories SET
          category_id = '${group.id}',
          sort_order = (SELECT CASE name ${caseClauses} END FROM subcategories_old WHERE subcategories_old.id = subcategories.id)
        WHERE id IN (
          SELECT id FROM subcategories_old
          WHERE name IN (${namesList})
            AND group_id = (SELECT id FROM groups WHERE name = '${group.groupName.replace(/'/g, "''")}')
        );
      `);

      expoDb.execSync(`
        DELETE FROM categories WHERE id IN (
          SELECT 'cat_' || id FROM subcategories_old
          WHERE name IN (${namesList})
            AND group_id = (SELECT id FROM groups WHERE name = '${group.groupName.replace(/'/g, "''")}')
        );
      `);
    }

    expoDb.execSync('DROP TABLE subcategories_old;');
    expoDb.execSync('DROP TABLE subcategory_states_old;');

    expoDb.execSync('COMMIT;');
  } catch (error) {
    expoDb.execSync('ROLLBACK;');
    throw error;
  } finally {
    expoDb.execSync('PRAGMA foreign_keys = ON;');
  }
}

/** Small deterministic id generator for rows created during migration, before `createId()` is reachable here. */
function migrationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * v3 had a Group -> Category -> Subcategory hierarchy, where a group owned
 * the funding card/due day shared by one or more categories. v4 removes the
 * group level entirely: category absorbs the card/due-day fields directly,
 * becoming the funded unit itself. Preserves every category's id (so
 * `subcategories.category_id` never needs rewriting) by renaming the old
 * tables aside, rebuilding the new shapes, and copying data across.
 *
 * The one genuinely computed step is `fundings`: it used to be keyed by
 * group, so a group with more than one category shared a single funding
 * pool. Splitting that pool onto N independent categories requires dividing
 * each historical funding amount proportionally by each category's share of
 * the group's total planned amount — done in JS below since it needs
 * per-row rounding with an exact-sum guarantee that plain SQL can't express
 * cleanly. In practice every real category has exactly one child, so this
 * path is a safety net, not the common case, but it must still be correct.
 */
function migrateV3ToV4(): void {
  const hasGroups = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='groups'`,
  );
  if (!hasGroups) return;

  expoDb.execSync('PRAGMA foreign_keys = OFF;');
  expoDb.execSync('BEGIN IMMEDIATE;');

  try {
    expoDb.execSync('ALTER TABLE groups RENAME TO groups_old;');
    expoDb.execSync('ALTER TABLE categories RENAME TO categories_old;');
    expoDb.execSync('ALTER TABLE fundings RENAME TO fundings_old;');

    // New top-level `categories` shape — absorbs the group's card/due-day/color/icon.
    expoDb.execSync(`CREATE TABLE categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      color TEXT NOT NULL DEFAULT '#6366F1',
      icon TEXT NOT NULL DEFAULT 'albums-outline',
      due_day INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`);

    expoDb.execSync(`CREATE TABLE fundings (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      period TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      date INTEGER NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`);

    // Every old category keeps its id; it inherits its parent group's
    // card/due-day/color/icon, which every sibling category shared before.
    expoDb.execSync(`
      INSERT INTO categories (id, name, card_id, color, icon, due_day, sort_order, archived_at, created_at, updated_at)
      SELECT c.id, c.name, g.card_id, g.color, g.icon, g.due_day, c.sort_order, c.archived_at, c.created_at, c.updated_at
      FROM categories_old c JOIN groups_old g ON g.id = c.group_id;
    `);

    // Groups with exactly one category: a direct, unambiguous copy.
    expoDb.execSync(`
      INSERT INTO fundings (id, category_id, card_id, period, amount_minor, date, note, created_at, updated_at)
      SELECT f.id, c.id, f.card_id, f.period, f.amount_minor, f.date, f.note, f.created_at, f.updated_at
      FROM fundings_old f
      JOIN groups_old g ON g.id = f.group_id
      JOIN categories_old c ON c.group_id = g.id
      WHERE (SELECT COUNT(*) FROM categories_old c2 WHERE c2.group_id = g.id) = 1;
    `);

    // Groups with more than one category: split each historical funding
    // amount proportionally by each category's share of planned spend.
    const multiCategoryGroups = expoDb.getAllSync(
      `SELECT group_id AS groupId, COUNT(*) AS count
       FROM categories_old GROUP BY group_id HAVING COUNT(*) > 1`,
    ) as { groupId: string; count: number }[];

    for (const { groupId } of multiCategoryGroups) {
      const groupCategories = expoDb.getAllSync(
        `SELECT id FROM categories_old WHERE group_id = '${groupId.replace(/'/g, "''")}' ORDER BY sort_order, id`,
      ) as { id: string }[];

      const shares = groupCategories.map(({ id }) => {
        const row = expoDb.getFirstSync(
          `SELECT COALESCE(SUM(planned_minor), 0) AS total FROM subcategories WHERE category_id = '${id.replace(/'/g, "''")}' AND archived_at IS NULL`,
        ) as { total: number } | null;
        return row?.total ?? 0;
      });

      const groupTotal = shares.reduce((sum, share) => sum + share, 0);
      const fractions =
        groupTotal > 0
          ? shares.map((share) => share / groupTotal)
          : groupCategories.map(() => 1 / groupCategories.length);

      const groupFundings = expoDb.getAllSync(
        `SELECT * FROM fundings_old WHERE group_id = '${groupId.replace(/'/g, "''")}'`,
      ) as {
        id: string;
        card_id: string | null;
        period: string;
        amount_minor: number;
        date: number;
        note: string | null;
        created_at: number;
        updated_at: number;
      }[];

      for (const funding of groupFundings) {
        let remaining = funding.amount_minor;
        groupCategories.forEach((category, index) => {
          const isLast = index === groupCategories.length - 1;
          const amount = isLast ? remaining : Math.round(funding.amount_minor * fractions[index]);
          remaining -= amount;

          const newId = migrationId('fund');
          const noteValue = funding.note ? `'${funding.note.replace(/'/g, "''")}'` : 'NULL';
          expoDb.execSync(`
            INSERT INTO fundings (id, category_id, card_id, period, amount_minor, date, note, created_at, updated_at)
            VALUES (
              '${newId}', '${category.id}',
              ${funding.card_id ? `'${funding.card_id}'` : 'NULL'},
              '${funding.period}', ${amount}, ${funding.date}, ${noteValue},
              ${funding.created_at}, ${funding.updated_at}
            );
          `);
        });
      }
    }

    expoDb.execSync('DROP TABLE categories_old;');
    expoDb.execSync('DROP TABLE fundings_old;');
    expoDb.execSync('DROP TABLE groups_old;');

    expoDb.execSync('COMMIT;');
  } catch (error) {
    expoDb.execSync('ROLLBACK;');
    throw error;
  } finally {
    expoDb.execSync('PRAGMA foreign_keys = ON;');
  }
}

/**
 * `CREATE TABLE IF NOT EXISTS` never adds columns to a table that already
 * exists — so a table that predates a column addition (e.g. `cards` gaining
 * `bank_name`/`last4` in v3) is silently stuck on its old shape forever,
 * even after `user_version` is bumped, since the migration gate only fires
 * once. This runs unconditionally on every launch and is a no-op once the
 * column is present, so it both completes the v2->v3 upgrade and self-heals
 * any device that already got bumped to v3 without picking up the column
 * (as happened here: `cards` DDL was missed from the original migration).
 */
function ensureColumn(table: string, column: string, ddl: string): void {
  const columns = expoDb.getAllSync(`PRAGMA table_info(${table})`) as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  expoDb.execSync(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
}

function ensureAdditiveColumns(): void {
  const hasCards = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='cards'`,
  );
  if (hasCards) {
    ensureColumn('cards', 'bank_name', 'bank_name TEXT');
    ensureColumn('cards', 'last4', 'last4 TEXT');
    ensureColumn('cards', 'bank_id', 'bank_id TEXT');
  }

  const hasLoans = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='loans'`,
  );
  if (hasLoans) {
    ensureColumn('loans', 'bank_id', 'bank_id TEXT');
  }

  const hasCategories = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='categories'`,
  );
  if (hasCategories) {
    ensureColumn(
      'categories',
      'default_frequency',
      "default_frequency TEXT NOT NULL DEFAULT 'monthly'",
    );
  }

  const hasSubcategoryStates = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='subcategory_states'`,
  );
  if (hasSubcategoryStates) {
    ensureColumn('subcategory_states', 'image_uri', 'image_uri TEXT');
  }
}

/**
 * Mirrors `groupColors` in src/theme/index.ts — duplicated as a plain literal
 * here rather than imported, since this DB layer must not pull in the UI
 * theme module. `color` is a decorative, auto-assigned field the user never
 * picks, so any row whose value isn't one of these current hues is a stale
 * artifact (e.g. from a pre-redesign palette, or inherited from a `groups`
 * row that predated this palette entirely — see `migrateV3ToV4`) and gets
 * reassigned round-robin, exactly like a freshly created row would.
 */
const CURRENT_PALETTE = [
  '#0F6FDE',
  '#0E9F6E',
  '#B7791F',
  '#0FA8A0',
  '#5B6472',
  '#2E6BB8',
  '#7C8A3D',
  '#0891B2',
];

function normalizeStaleColors(table: string): void {
  const rows = expoDb.getAllSync(
    `SELECT id, color FROM ${table} ORDER BY sort_order, id`,
  ) as { id: string; color: string }[];

  let index = 0;
  for (const row of rows) {
    if (CURRENT_PALETTE.includes(row.color)) {
      index += 1;
      continue;
    }
    const nextColor = CURRENT_PALETTE[index % CURRENT_PALETTE.length];
    expoDb.execSync(
      `UPDATE ${table} SET color = '${nextColor}' WHERE id = '${row.id.replace(/'/g, "''")}';`,
    );
    index += 1;
  }
}

/**
 * One-time-per-value repair, unconditional and idempotent like
 * `ensureAdditiveColumns` — rows already on the current palette are left
 * untouched, so this is a no-op on every launch after the first.
 */
function ensureCurrentColors(): void {
  const hasCategories = expoDb.getFirstSync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='categories'`,
  );
  if (hasCategories) normalizeStaleColors('categories');
}

let initialised = false;

/** Create the schema if needed. Safe to call repeatedly; runs once per launch. */
export function initialiseDatabase(): void {
  if (initialised) return;

  expoDb.execSync('PRAGMA journal_mode = WAL;');
  expoDb.execSync('PRAGMA foreign_keys = ON;');

  const version = (
    expoDb.getFirstSync('PRAGMA user_version') as { user_version?: number } | null
  )?.user_version;

  // v1 was a transaction-ledger schema with an incompatible shape. There is no
  // sensible field-by-field migration to the funding board, and the only data
  // was seeded demo content, so the old tables are dropped outright and the
  // device lands directly on the fresh v3 DDL below.
  if (version === 1) {
    for (const table of ['transactions', 'recurring_rules']) {
      expoDb.execSync(`DROP TABLE IF EXISTS ${table};`);
    }
    for (const table of ['category_states', 'fundings', 'categories', 'groups']) {
      expoDb.execSync(`DROP TABLE IF EXISTS ${table};`);
    }
    expoDb.execSync(`DELETE FROM settings WHERE key = 'seeded';`);
  }

  // v2's categories were real budget lines; v3 splits label from leaf. This
  // is the user's real financial history, so it is transcribed, not dropped.
  if (version === 2) {
    migrateV2ToV3();
  }

  // v4 removes the group level. Gated on the `groups` table actually
  // existing (checked inside the function), not on the recorded version —
  // a device can end up with `user_version` already at 4 while its tables
  // are still shaped like v3 (e.g. an interrupted upgrade, or a build that
  // bumped the constant before this migration existed), and a version-only
  // gate would then skip the migration forever. Matches the same
  // table-shape-over-version-number lesson as `ensureAdditiveColumns` below.
  migrateV3ToV4();

  // Unconditional and idempotent — see ensureAdditiveColumns' doc comment.
  ensureAdditiveColumns();
  ensureCurrentColors();

  for (const statement of DDL) {
    expoDb.execSync(statement);
  }

  expoDb.execSync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  initialised = true;
}

/**
 * Wipe all data but keep the schema — used by "Clear all data" in settings.
 *
 * `settings` is cleared too, which would let a naive re-launch treat this as
 * a fresh install. Callers that want the app to stay genuinely empty (rather
 * than replaying onboarding or a seed) must re-set the relevant settings
 * flags themselves afterwards.
 */
export function resetDatabase(): void {
  const tables = [
    'subcategory_states',
    'fundings',
    'subcategories',
    'categories',
    'incomes',
    'loans',
    'cards',
    'settings',
  ];
  expoDb.execSync('PRAGMA foreign_keys = OFF;');
  for (const table of tables) {
    expoDb.execSync(`DELETE FROM ${table};`);
  }
  expoDb.execSync('PRAGMA foreign_keys = ON;');
}
