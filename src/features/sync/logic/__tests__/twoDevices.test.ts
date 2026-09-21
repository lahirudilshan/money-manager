import { describe, expect, it } from 'vitest';
import {
  describeMerge,
  mergeTables,
  pruneTombstones,
  TOMBSTONE_TTL_MS,
} from '~/features/sync/logic/merge';

/** Two phones, each holding their own copy, merging through one Drive file. */
describe('two-device sync simulation', () => {
  const T0 = 1_000_000;

  it('both people keep their own additions', () => {
    const drive = { transactions: [{ id: 'shared', updated_at: T0, name: 'Rent' }] };

    // Husband adds a transaction offline.
    const his = mergeTables(
      { transactions: [{ id: 'h1', updated_at: T0 + 10, name: 'Fuel' }] },
      drive,
    );
    // Wife adds one offline, from the same original file.
    const hers = mergeTables(
      { transactions: [{ id: 'w1', updated_at: T0 + 20, name: 'Milk' }] },
      drive,
    );

    // He uploads, then she merges his file with hers and uploads.
    const afterHim = mergeTables(drive, his);
    const afterHer = mergeTables(afterHim, hers);

    expect(afterHer.transactions.map((r) => r.id).sort()).toEqual(['h1', 'shared', 'w1']);
  });

  it('converges: both devices end byte-identical', () => {
    const a = { t: [{ id: 'x', updated_at: 5, v: 'a' }, { id: 'only-a', updated_at: 1 }] };
    const b = { t: [{ id: 'x', updated_at: 9, v: 'b' }, { id: 'only-b', updated_at: 1 }] };

    // Whichever order they sync in, the result must match.
    expect(mergeTables(mergeTables(a, b), a)).toEqual(mergeTables(mergeTables(b, a), b));
  });

  it('a delete on one phone removes the row on the other', () => {
    const drive = { t: [{ id: 'x', updated_at: T0, name: 'Old bill' }] };
    // Wife deletes it.
    const hers = { t: [{ id: 'x', updated_at: T0 + 50, deleted_at: T0 + 50 }] };
    const merged = mergeTables(drive, hers);

    expect(merged.t).toHaveLength(1);
    expect(merged.t[0].deleted_at).toBe(T0 + 50);
  });

  it('a hard delete WOULD have resurrected the row — the tombstone prevents it', () => {
    const drive = { t: [{ id: 'x', updated_at: T0, name: 'Old bill' }] };
    // Without a tombstone the row is simply absent on her side...
    const hardDeleted = { t: [] as Record<string, unknown>[] };
    expect(mergeTables(drive, hardDeleted).t).toHaveLength(1); // ...and comes back.
  });

  it('an edit after a delete wins, and the row returns', () => {
    const deleted = { t: [{ id: 'x', updated_at: 100, deleted_at: 100 }] };
    const edited = { t: [{ id: 'x', updated_at: 200, name: 'Recreated' }] };
    const merged = mergeTables(deleted, edited);
    expect(merged.t[0].deleted_at).toBeUndefined();
    expect(merged.t[0].name).toBe('Recreated');
  });

  it('reports what changed before writing', () => {
    const mine = { t: [{ id: 'a', updated_at: 1 }] };
    const theirs = { t: [{ id: 'b', updated_at: 1 }] };
    expect(describeMerge(mine, theirs)).toEqual({ pulled: 1, pushed: 1, conflicts: 0 });
  });

  it('old tombstones are dropped, live rows never are', () => {
    /*
     * A REAL epoch-ms clock, not a small round number.
     *
     * The first draft used 2_000_000_000 — which is smaller than the 90-day TTL
     * in milliseconds, so every row's age came out under the threshold and
     * nothing was ever pruned. The fixture was wrong, not the pruning.
     */
    const now = Date.parse('2026-09-15T00:00:00Z');
    const tables = {
      t: [
        { id: 'live', updated_at: 1 },
        { id: 'recent-delete', updated_at: now - 1000, deleted_at: 1 },
        {
          id: 'ancient-delete',
          updated_at: now - TOMBSTONE_TTL_MS - 1,
          deleted_at: 1,
        },
      ],
    };
    const pruned = pruneTombstones(tables, now);
    expect(pruned.t.map((r) => r.id)).toEqual(['live', 'recent-delete']);
  });
});
