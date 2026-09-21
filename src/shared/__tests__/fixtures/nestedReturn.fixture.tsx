/*
 * The legitimate shape the detector must NOT flag, so a false positive is
 * caught as quickly as a missed one. Not rendered anywhere.
 *
 * Every `return` here is inside a callback — a `.filter()` predicate and a
 * `useMemo` body — so none of them leaves the component early, and the hooks
 * that follow run on every render.
 */
import { useMemo, useState } from 'react';

export function FineScreen({ rows }: { rows: { id: string; on: boolean }[] }) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (!r.on) return false;
      return r.id.includes(query);
    });
  }, [rows, query]);

  const count = useMemo(() => visible.length, [visible]);

  return String(count) + String(setQuery);
}
