import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Every table that spreads `timestamps` must also be migrated.
 *
 * Drizzle writes every column the helper declares, so a table carrying
 * `deletedAt` in the schema but missing `deleted_at` in the database makes
 * EVERY insert fail. That is not a subtle degradation: it silently broke all
 * SMS intake — the file was read, parsed, then thrown away with the error
 * swallowed — and nothing pointed at the cause.
 *
 * Reading the source rather than importing is deliberate: `client.ts` opens a
 * real SQLite database on import, which does not exist under vitest.
 */
describe('tombstone column coverage', () => {
  const schema = readFileSync(new URL('../schema.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../client.ts', import.meta.url), 'utf8');

  /** Tables whose definition spreads the shared `timestamps` helper. */
  function tablesWithTimestamps(): string[] {
    const found: string[] = [];
    const re = /sqliteTable\(\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(schema)) !== null) {
      const rest = schema.slice(match.index + match[0].length);
      const next = rest.indexOf('sqliteTable(');
      const body = next > 0 ? rest.slice(0, next) : rest.slice(0, 5000);
      if (body.includes('...timestamps')) found.push(match[1]);
    }
    return found;
  }

  function migratedTables(): string[] {
    const start = client.indexOf('const SYNCED_TABLES');
    const block = client.slice(start, start + 3000);
    return [...block.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
  }

  it('migrates every table that declares a tombstone', () => {
    const declared = tablesWithTimestamps();
    const migrated = new Set(migratedTables());
    expect(declared.filter((table) => !migrated.has(table))).toEqual([]);
  });

  /* The regression that motivated this file. */
  it('includes sms_inbox, whose omission broke all SMS intake', () => {
    expect(migratedTables()).toContain('sms_inbox');
  });

  it('finds a plausible number of tables, so a broken regex cannot pass', () => {
    expect(tablesWithTimestamps().length).toBeGreaterThan(20);
  });
});
