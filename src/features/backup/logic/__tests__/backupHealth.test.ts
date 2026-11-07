import { describe, expect, it } from 'vitest';
import {
  BACKUP_PARTS,
  DEFAULT_BACKUP_PARTS,
  SNAPSHOT_TABLES,
  tablesForParts,
  tableInScope,
} from '../backup';

describe('health is a sensitive backup part, included by default', () => {
  it('is in the default backup — a reinstall must not lose medical history', () => {
    expect(DEFAULT_BACKUP_PARTS).toContain('health');
  });

  it('is flagged sensitive, like SMS text', () => {
    const part = BACKUP_PARTS.find((p) => p.key === 'health');
    expect(part?.sensitive).toBe(true);
  });

  it('carries every health table together', () => {
    const tables = tablesForParts(['health']);
    expect(tables).toEqual(
      expect.arrayContaining([
        'health_people',
        'health_visits',
        'health_medicines',
        'health_documents',
        'health_readings',
      ]),
    );
  });

  it('orders parents before children so a restore cannot break a foreign key', () => {
    const order = (t: string) => SNAPSHOT_TABLES.indexOf(t as never);
    expect(order('health_people')).toBeLessThan(order('health_visits'));
    // A medicine points at the visit that prescribed it.
    expect(order('health_visits')).toBeLessThan(order('health_medicines'));
    expect(order('health_visits')).toBeLessThan(order('health_documents'));
    expect(order('health_visits')).toBeLessThan(order('health_readings'));
  });

  it('keeps people and medicines on a setup-only restore, but drops the events', () => {
    expect(tableInScope('health_people', 'setup')).toBe(true);
    expect(tableInScope('health_medicines', 'setup')).toBe(true);
    expect(tableInScope('health_visits', 'setup')).toBe(false);
    expect(tableInScope('health_documents', 'setup')).toBe(false);
    expect(tableInScope('health_readings', 'setup')).toBe(false);
  });
});


describe('every table can be backed up', () => {
  it('everySnapshotTableHasAPart — no table is silently left out of backups', () => {
    /*
     * A backup reads only the tables its parts name. A snapshot table in no
     * part is written as empty forever — which is how buddy loans went
     * missing from every backup until this test existed.
     */
    const covered = new Set(BACKUP_PARTS.flatMap((part) => part.tables));
    const orphaned = SNAPSHOT_TABLES.filter((table) => !covered.has(table));
    expect(orphaned).toEqual([]);
  });

  it('backs up buddy loans by default', () => {
    expect(tablesForParts(DEFAULT_BACKUP_PARTS)).toEqual(
      expect.arrayContaining(['buddy_loans', 'buddy_repayments']),
    );
  });
});
