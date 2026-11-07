import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_TABLES } from '~/features/backup/logic/backup';
import {
  ALL_TABLES,
  RECORD_TABLES,
  RESET_AREAS,
  rowsToClear,
  tablesToClear,
} from '~/features/backup/logic/resetPlan';

const ddl = readFileSync(resolve(__dirname, '../../../../db/client.ts'), 'utf8');
const createdTables = [...new Set([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))];

describe('erase everything', () => {
  it('erases every table the database creates — health, buddy loans and trackers included', () => {
    const cleared = new Set(tablesToClear('everything'));
    expect(createdTables.filter((t) => !cleared.has(t))).toEqual([]);
  });

  it('deletes children before their parents', () => {
    const order = tablesToClear('everything');
    const at = (t: string) => order.indexOf(t);
    expect(at('transaction_splits')).toBeLessThan(at('transactions'));
    expect(at('transactions')).toBeLessThan(at('subcategories'));
    expect(at('buddy_repayments')).toBeLessThan(at('buddy_loans'));
    expect(at('health_lab_results')).toBeLessThan(at('health_people'));
    expect(at('refills')).toBeLessThan(at('tracked_items'));
  });
});

describe('erase records, keep setup', () => {
  const cleared = tablesToClear('records');

  it('keeps the setup', () => {
    for (const kept of [
      'settings',
      'cards',
      'categories',
      'subcategories',
      'incomes',
      'houses',
      'loans',
      'vehicles',
      'merchant_rules',
      'health_people',
      'health_medicines',
      'buddy_loans',
      'buddy_repayments',
      'tracked_items',
    ]) {
      expect(cleared).not.toContain(kept);
    }
  });

  it('erases the records', () => {
    expect(cleared).toEqual(
      expect.arrayContaining(['transactions', 'transaction_splits', 'fundings', 'health_readings', 'refills', 'sms_log']),
    );
  });

  it('every table is either setup or record — none is unclassified by accident', () => {
    // A new table must be placed deliberately: add it to RECORD_TABLES, or here.
    const setup = new Set([
      'settings', 'cards', 'houses', 'loans', 'vehicles', 'categories', 'incomes',
      'merchant_rules', 'subcategories', 'health_people', 'health_medicines',
      'buddy_loans', 'buddy_repayments', 'tracked_items', 'doc_folders', 'doc_files',
    ]);
    const records = new Set(RECORD_TABLES);
    expect(ALL_TABLES.filter((t) => !setup.has(t) && !records.has(t))).toEqual([]);
  });
});

describe('erase chosen areas', () => {
  it('erases only the ticked areas', () => {
    expect(tablesToClear('areas', ['buddyloans'])).toEqual(['buddy_repayments', 'buddy_loans']);
    expect(tablesToClear('areas', [])).toEqual([]);
  });

  it('every table can be reached through some area', () => {
    const reachable = new Set(RESET_AREAS.flatMap((a) => a.tables));
    expect(ALL_TABLES.filter((t) => t !== 'settings' && !reachable.has(t))).toEqual([]);
  });

  it('names only tables that exist', () => {
    const known = new Set<string>([...SNAPSHOT_TABLES, 'sms_log']);
    for (const area of RESET_AREAS) for (const t of area.tables) expect(known.has(t)).toBe(true);
  });

  it('counts the rows that will go', () => {
    expect(rowsToClear(['buddy_loans', 'buddy_repayments'], { buddy_loans: 5, buddy_repayments: 1, cards: 9 })).toBe(6);
  });
});
