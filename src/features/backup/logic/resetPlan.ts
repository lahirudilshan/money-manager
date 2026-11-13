/**
 * What "Clear data" erases, for each of the three ways to clear.
 *
 *   - `everything` — every table, settings included, and back to setup. What
 *     "Clear all data" always did, except it now really is ALL: the old list
 *     was written before health, buddy loans, vehicles and the usage tracker
 *     existed, and a wipe left every one of them behind.
 *   - `records`    — the records, keeping the setup. Accounts, categories and
 *     bills, houses, loans, vehicles, family members and their medicines,
 *     buddy loans and tracked items stay; every payment, reading, visit,
 *     service and message goes. For starting a fresh year on a board that took
 *     an afternoon to build.
 *   - `areas`      — only the areas the user ticks.
 *
 * The table lists are derived from the backup map (`SNAPSHOT_TABLES`,
 * `NOT_BACKED_UP`), not written out again, so a table added for backup is
 * also one a full clear erases — `resetPlan.test.ts` holds that line.
 *
 * Pure: no database. `clearTables` in db/client.ts does the deleting.
 */
import type { Ionicons } from '@expo/vector-icons';
import { NOT_BACKED_UP, SNAPSHOT_TABLES } from './backup';

export type ResetMode = 'everything' | 'records' | 'areas';

export type ResetAreaKey =
  | 'history'
  | 'plan'
  | 'accounts'
  | 'houses'
  | 'loans'
  | 'vehicles'
  | 'health'
  | 'buddyloans'
  | 'trackers'
  | 'documents'
  | 'rules'
  | 'messages';

export interface ResetArea {
  key: ResetAreaKey;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  tables: readonly string[];
  /**
   * What ELSE goes with it, said before the user confirms.
   *
   * The database enforces its foreign keys: a payment cannot outlive the bill
   * it was paid against, so erasing categories takes their payments with it.
   * That is right — an orphaned payment is not a state any screen can show —
   * but it must not come as a surprise.
   */
  alsoErases?: string;
}

/** Every table the app creates, children before the rows they reference. */
export const ALL_TABLES: readonly string[] = [...SNAPSHOT_TABLES, ...Object.keys(NOT_BACKED_UP)];

/** Money moving, and the per-month facts derived from it. */
const MONEY_RECORDS = [
  'transactions',
  'transaction_splits',
  'subcategory_states',
  'category_states',
  'fundings',
  'fuel_entries',
  'account_transfers',
  'account_moves',
  'balance_checkpoints',
  'meter_readings',
] as const;

export const RESET_AREAS: readonly ResetArea[] = [
  {
    key: 'history',
    label: 'Transactions & history',
    hint: 'Payments, transfers, balances and paid ticks',
    icon: 'receipt-outline',
    tables: MONEY_RECORDS,
  },
  {
    key: 'plan',
    label: 'Categories & bills',
    hint: 'Your plan, its bills and income',
    icon: 'grid-outline',
    tables: ['categories', 'subcategories', 'incomes'],
    alsoErases: 'Payments recorded against those bills go too.',
  },
  {
    key: 'accounts',
    label: 'Accounts',
    hint: 'Banks and cards',
    icon: 'card-outline',
    tables: ['cards'],
    alsoErases: 'Their balances and transfers go too; bills just lose their account.',
  },
  {
    key: 'houses',
    label: 'Houses',
    hint: 'Properties you track bills for',
    icon: 'home-outline',
    tables: ['houses'],
    alsoErases: 'Bills stay — they just stop belonging to a house.',
  },
  {
    key: 'loans',
    label: 'Loans',
    hint: 'Loans you are paying off',
    icon: 'cash-outline',
    tables: ['loans'],
  },
  {
    key: 'vehicles',
    label: 'Vehicles',
    hint: 'Vehicles, fuel and service records',
    icon: 'car-outline',
    tables: ['vehicles', 'vehicle_services', 'service_items', 'maintenance_marks', 'maintenance_overrides', 'fuel_entries'],
  },
  {
    key: 'health',
    label: 'Health records',
    hint: 'People, visits, medicines, reports and readings',
    icon: 'medkit-outline',
    tables: [
      'health_people',
      'health_visits',
      'health_medicines',
      'health_documents',
      'health_readings',
      'health_analyses',
      'health_lab_results',
    ],
    alsoErases: 'Report files already in your Google Drive are not touched.',
  },
  {
    key: 'buddyloans',
    label: 'Buddy loans',
    hint: 'Money you lent, and repayments',
    icon: 'people-outline',
    tables: ['buddy_loans', 'buddy_repayments'],
  },
  {
    key: 'trackers',
    label: 'Usage tracker',
    hint: 'Tracked items and their refills',
    icon: 'repeat-outline',
    tables: ['tracked_items', 'refills'],
  },
  {
    key: 'documents',
    label: 'Documents',
    hint: 'Folders and the files kept in them',
    icon: 'folder-open-outline',
    tables: ['doc_folders', 'doc_files'],
    alsoErases: 'Files already in your Google Drive are not touched.',
  },
  {
    key: 'rules',
    label: 'Learned merchants',
    hint: 'Shops the app has learned to sort',
    icon: 'sparkles-outline',
    tables: ['merchant_rules'],
  },
  {
    key: 'messages',
    label: 'Bank messages',
    hint: 'Smart Detect queue and message log',
    icon: 'chatbubbles-outline',
    tables: ['sms_inbox', 'sms_log'],
  },
];

/**
 * The RECORDS — what `records` mode erases. Everything else is setup and stays.
 *
 * Buddy loans stay: like a bank loan they are an open balance someone still
 * owes, not a closed record of the past. Tracked items stay and restart from
 * today (`startUnstartedItems` gives each a fresh first refill).
 */
export const RECORD_TABLES: readonly string[] = [
  ...MONEY_RECORDS,
  'vehicle_services',
  'service_items',
  'maintenance_marks',
  'health_visits',
  'health_documents',
  'health_readings',
  'health_analyses',
  'health_lab_results',
  'refills',
  'sms_inbox',
  'sms_log',
];

/** What the `records` mode keeps, in words, for the sheet. */
export const RECORDS_KEEP =
  'Accounts, categories & bills, income, houses, loans, buddy loans, vehicles, family members & medicines, tracked items, documents and settings';
export const RECORDS_ERASE =
  'Transactions, transfers, balances, paid ticks, fuel & service records, health visits, reports & readings, refills and bank messages';

/**
 * The tables a clear deletes, ordered children first.
 *
 * Order is the reverse of the snapshot's dependency order, so a child row is
 * gone before its parent and no foreign key is ever left pointing at nothing.
 */
export function tablesToClear(mode: ResetMode, areas: readonly ResetAreaKey[] = []): string[] {
  let wanted: Set<string>;
  if (mode === 'everything') wanted = new Set(ALL_TABLES);
  else if (mode === 'records') wanted = new Set(RECORD_TABLES);
  else
    wanted = new Set(
      RESET_AREAS.filter((area) => areas.includes(area.key)).flatMap((area) => area.tables),
    );
  return [...ALL_TABLES].reverse().filter((table) => wanted.has(table));
}

/** Rows a clear would erase, from per-table counts. Cascades are not counted. */
export function rowsToClear(tables: readonly string[], counts: Record<string, number>): number {
  return tables.reduce((sum, table) => sum + (counts[table] ?? 0), 0);
}
