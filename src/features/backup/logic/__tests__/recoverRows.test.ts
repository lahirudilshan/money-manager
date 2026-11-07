import { describe, expect, it } from 'vitest';
import { missingRows, onlyColumns } from '~/features/backup/logic/recoverRows';

describe('recovering rows from an older copy', () => {
  it('adds only rows this phone does not have, and never deleted ones', () => {
    const source = [
      { id: 'a', amount: 1, deleted_at: null },
      { id: 'b', amount: 2, deleted_at: null },
      { id: 'c', amount: 3, deleted_at: 1700000000000 },
      { amount: 4 },
    ];
    expect(missingRows(source, new Set(['a'])).map((r) => r.id)).toEqual(['b']);
  });

  it('drops columns this database does not have', () => {
    expect(onlyColumns({ id: 'a', name: 'Nuwan', future_column: 1 }, new Set(['id', 'name']))).toEqual({
      id: 'a',
      name: 'Nuwan',
    });
  });
});
