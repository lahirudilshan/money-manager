/*
 * The bug shape, preserved so the detector in hooksAfterGuard.test.ts is
 * itself tested. Not rendered anywhere — it exists to be read as text.
 *
 * This is what crashed the subcategory and account sheets on delete: the guard
 * fires on the render where the record has gone, and `useMemo` below it is
 * skipped after React counted it on the previous render.
 */
import { useMemo, useState } from 'react';

export function BrokenScreen({ row }: { row: { id: string } | undefined }) {
  const [open, setOpen] = useState(false);

  if (!row) {
    return null;
  }

  const derived = useMemo(() => row.id.toUpperCase(), [row]);

  return derived + String(open) + String(setOpen);
}
