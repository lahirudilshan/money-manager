import { describe, expect, it } from 'vitest';
import {
  describeMerge,
  isDeleted,
  mergeTable,
  mergeTables,
  pruneTombstones,
  rowTime,
  TOMBSTONE_TTL_MS,
  type TableRows,
} from '~/features/sync/logic/merge';

const row = (id: string, updated: number, extra: Record<string, unknown> = {}) => ({
  id,
  updated_at: updated,
  ...extra,
});

describe('rowTime', () => {
  it('reads a numeric timestamp', () => {
    expect(rowTime(row('a', 1700))).toBe(1700);
  });

  /*
   * A row this system cannot date must LOSE every comparison. Preferring it
   * would overwrite data whose history is actually known.
   */
  it('treats a missing or unusable timestamp as the oldest possible', () => {
    expect(rowTime({ id: 'a' })).toBe(0);
    expect(rowTime({ id: 'a', updated_at: 'not a date' })).toBe(0);
  });

  it('parses a timestamp that survived JSON as a string', () => {
    expect(rowTime({ id: 'a', updated_at: '1700' })).toBe(1700);
  });
});

describe('mergeTable', () => {
  it('keeps rows only one side has', () => {
    const merged = mergeTable([row('a', 1)], [row('b', 1)]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('prefers the newer version of a row present on both', () => {
    const merged = mergeTable(
      [row('a', 100, { name: 'mine' })],
      [row('a', 200, { name: 'theirs' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('theirs');
  });

  it('keeps the local version when it is newer', () => {
    const merged = mergeTable(
      [row('a', 300, { name: 'mine' })],
      [row('a', 200, { name: 'theirs' })],
    );
    expect(merged[0].name).toBe('mine');
  });

  /*
   * Determinism matters more than which side wins: if the two phones resolved a
   * tie differently they would each see the other's file as changed and upload
   * forever.
   */
  it('resolves a tie the same way every time', () => {
    const a = mergeTable([row('x', 5, { v: 'mine' })], [row('x', 5, { v: 'theirs' })]);
    const b = mergeTable([row('x', 5, { v: 'mine' })], [row('x', 5, { v: 'theirs' })]);
    expect(a).toEqual(b);
    expect(a[0].v).toBe('mine');
  });

  it('orders output by id so both devices produce identical files', () => {
    const one = mergeTable([row('c', 1), row('a', 1)], [row('b', 1)]);
    const two = mergeTable([row('b', 1)], [row('a', 1), row('c', 1)]);
    expect(one.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(two.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('mutates neither input', () => {
    const mine = [row('a', 1)];
    const theirs = [row('a', 2)];
    mergeTable(mine, theirs);
    expect(mine).toEqual([row('a', 1)]);
    expect(theirs).toEqual([row('a', 2)]);
  });

  it('ignores rows with no usable id', () => {
    const merged = mergeTable([row('a', 1)], [{ updated_at: 5 } as never]);
    expect(merged.map((r) => r.id)).toEqual(['a']);
  });
});

describe('tombstones', () => {
  it('recognises a deleted row', () => {
    expect(isDeleted(row('a', 1, { deleted_at: 1700 }))).toBe(true);
    expect(isDeleted(row('a', 1))).toBe(false);
    expect(isDeleted(row('a', 1, { deleted_at: null }))).toBe(false);
  });

  /* The whole reason tombstones exist: a bare absence would be resurrected. */
  it('lets a delete win over an older live row', () => {
    const merged = mergeTable(
      [row('a', 100, { name: 'still here' })],
      [row('a', 200, { deleted_at: 200 })],
    );
    expect(isDeleted(merged[0])).toBe(true);
  });

  it('lets a later edit undo an earlier delete', () => {
    const merged = mergeTable(
      [row('a', 300, { name: 'recreated' })],
      [row('a', 200, { deleted_at: 200 })],
    );
    expect(isDeleted(merged[0])).toBe(false);
  });

  it('drops tombstones past the retention window', () => {
    const now = 1_000_000_000;
    const old = row('a', now - TOMBSTONE_TTL_MS - 1, { deleted_at: 1 });
    const fresh = row('b', now - 1000, { deleted_at: 1 });
    const pruned = pruneTombstones({ t: [old, fresh] }, now);
    expect(pruned.t.map((r) => r.id)).toEqual(['b']);
  });

  it('never drops a live row', () => {
    const now = 1_000_000_000;
    const ancient = row('a', 1);
    expect(pruneTombstones({ t: [ancient] }, now).t).toHaveLength(1);
  });
});

describe('mergeTables', () => {
  it('merges every table from both sides', () => {
    const mine: Record<string, TableRows> = { a: [row('1', 1)], shared: [row('x', 1)] };
    const theirs: Record<string, TableRows> = { b: [row('2', 1)], shared: [row('y', 1)] };
    const merged = mergeTables(mine, theirs);
    expect(Object.keys(merged)).toEqual(['a', 'b', 'shared']);
    expect(merged.shared.map((r) => r.id)).toEqual(['x', 'y']);
  });

  /*
   * A table the other phone has never heard of belongs to a feature it has not
   * updated to yet. Dropping it would delete that feature's data on every sync.
   */
  it('keeps a table only one side knows about', () => {
    const merged = mergeTables({}, { tracked_items: [row('gas', 1)] });
    expect(merged.tracked_items).toHaveLength(1);
  });
});

describe('describeMerge', () => {
  it('counts what each side contributes', () => {
    const mine = { t: [row('a', 1), row('b', 1)] };
    const theirs = { t: [row('b', 1), row('c', 1)] };
    const report = describeMerge(mine, theirs);
    expect(report.pulled).toBe(1);
    expect(report.pushed).toBe(1);
    expect(report.conflicts).toBe(0);
  });

  it('counts a genuine conflict once', () => {
    const report = describeMerge({ t: [row('a', 100)] }, { t: [row('a', 200)] });
    expect(report.conflicts).toBe(1);
    expect(report.pulled).toBe(1);
  });

  it('reports nothing for identical data', () => {
    const same = { t: [row('a', 1)] };
    expect(describeMerge(same, same)).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
  });
});
