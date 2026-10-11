/**
 * expo-sqlite's synchronous API, backed by node's built-in SQLite.
 *
 * The app's repositories and migrations talk to `expoDb` (the raw handle) and to
 * drizzle's expo-sqlite driver, which calls `prepareSync` / `executeSync` /
 * `executeForRawResultSync`. Implementing exactly that surface over
 * `node:sqlite` lets the REAL schema, migrations, repositories and store run
 * under vitest against a real database — the only way to check that figures
 * reconcile after a month of writes, rather than over a hand-built fixture.
 */
import { DatabaseSync } from 'node:sqlite';

type Param = string | number | bigint | null | Uint8Array;

/** expo-sqlite accepts booleans and Dates loosely; node:sqlite does not. */
function bind(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.getTime();
    return p as Param;
  });
}

function args(rest: unknown[]): Param[] {
  if (rest.length === 1 && Array.isArray(rest[0])) return bind(rest[0]);
  if (rest.length === 1 && rest[0] && typeof rest[0] === 'object') {
    return bind(Object.values(rest[0] as object));
  }
  return bind(rest);
}

export function openNodeDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);

  return {
    execSync(source: string) {
      db.exec(source);
    },
    runSync(source: string, ...rest: unknown[]) {
      const r = db.prepare(source).run(...args(rest));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllSync(source: string, ...rest: unknown[]) {
      return db.prepare(source).all(...args(rest));
    },
    getFirstSync(source: string, ...rest: unknown[]) {
      return db.prepare(source).get(...args(rest)) ?? null;
    },
    withTransactionSync(fn: () => void) {
      db.exec('BEGIN');
      try {
        fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    prepareSync(source: string) {
      const stmt = db.prepare(source);
      return {
        executeSync(params: unknown[] = []) {
          const bound = bind(params);
          // A statement that returns columns is read; anything else is a write.
          if (stmt.columns().length > 0) {
            const rows = stmt.all(...bound);
            return {
              changes: 0,
              lastInsertRowId: 0,
              getAllSync: () => rows,
              getFirstSync: () => rows[0] ?? null,
            };
          }
          const r = stmt.run(...bound);
          return {
            changes: Number(r.changes),
            lastInsertRowId: Number(r.lastInsertRowid),
            getAllSync: () => [],
            getFirstSync: () => null,
          };
        },
        executeForRawResultSync(params: unknown[] = []) {
          stmt.setReturnArrays(true);
          const rows = stmt.all(...bind(params));
          stmt.setReturnArrays(false);
          return { getAllSync: () => rows };
        },
        finalizeSync() {},
      };
    },
    closeSync() {
      db.close();
    },
  };
}
