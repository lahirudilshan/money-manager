import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_PARTS,
  BACKUP_PARTS,
  NOT_BACKED_UP,
  SNAPSHOT_TABLES,
  tablesForParts,
} from '~/features/backup/logic/backup';

/**
 * The guarantee: everything the user enters is in a full backup.
 *
 * Read from the database DDL itself, so a new table cannot be forgotten: it
 * either goes in a backup part or in `NOT_BACKED_UP` with a written reason.
 * Buddy loans and split-payment parts were silently missing from every backup
 * before this test existed.
 */
const ddl = readFileSync(resolve(__dirname, '../../../../db/client.ts'), 'utf8');
const createdTables = [...new Set([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))];

describe('backup coverage', () => {
  it('finds the tables in the DDL', () => {
    expect(createdTables.length).toBeGreaterThan(20);
    expect(createdTables).toContain('buddy_loans');
  });

  it('every table the database creates is backed up, or excluded on purpose', () => {
    const snapshot = new Set<string>(SNAPSHOT_TABLES);
    const forgotten = createdTables.filter((t) => !snapshot.has(t) && !(t in NOT_BACKED_UP));
    expect(forgotten).toEqual([]);
  });

  it('every backed-up table belongs to a part the user can tick', () => {
    const covered = new Set(BACKUP_PARTS.flatMap((part) => part.tables));
    expect(SNAPSHOT_TABLES.filter((t) => !covered.has(t))).toEqual([]);
  });

  it('a full backup includes every backed-up table', () => {
    expect(new Set(tablesForParts(ALL_PARTS))).toEqual(new Set(SNAPSHOT_TABLES));
  });

  it('every exclusion has a reason and names a real table', () => {
    for (const [table, reason] of Object.entries(NOT_BACKED_UP)) {
      expect(createdTables).toContain(table);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
