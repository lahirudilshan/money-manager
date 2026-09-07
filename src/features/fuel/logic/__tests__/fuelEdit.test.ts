import { describe, expect, it } from 'vitest';
import { tankWindows, type FuelFill } from '../fuel';

/**
 * What editing and deleting a fill-up does to the measured figures.
 *
 * The history screen exists so a mistyped fill-up can be corrected, and the
 * reason that matters is not the row itself — it is that consumption is measured
 * BETWEEN fills. One wrong odometer silently corrupts the figure either side of
 * it, and deleting a row merges two windows into one longer one.
 *
 * These pin that blast radius, so the screens above can promise it honestly.
 */

const day = (n: number) => new Date(2026, 0, n);

const fill = (
  id: string,
  odometer: number,
  litres: number,
  options: Partial<FuelFill> = {},
): FuelFill => ({
  id,
  odometer,
  litres,
  isFullTank: true,
  filledAt: day(Number(id.replace(/\D/g, '')) || 1),
  ...options,
});

/** Three full tanks, 400 km apart, 40 L each — a clean 10 km/L throughout. */
const log = [fill('f1', 1000, 40), fill('f2', 1400, 40), fill('f3', 1800, 40)];

const edit = (fills: readonly FuelFill[], id: string, patch: Partial<FuelFill>) =>
  fills.map((f) => (f.id === id ? { ...f, ...patch } : f));

const remove = (fills: readonly FuelFill[], id: string) => fills.filter((f) => f.id !== id);

describe('correcting a fill-up', () => {
  it('measures a clean log at the expected rate', () => {
    const windows = tankWindows(log);
    expect(windows).toHaveLength(2);
    expect(windows.map((w) => w.efficiency)).toEqual([10, 10]);
  });

  it('repairs BOTH windows around a mistyped odometer', () => {
    // The middle reading typed as 1040 rather than 1400: the first window
    // collapses to 1 km/L and the second inflates to 19.
    const typo = edit(log, 'f2', { odometer: 1040 });
    expect(tankWindows(typo).map((w) => w.efficiency)).toEqual([1, 19]);

    // Correcting that one row restores both — which is why the edit screen is
    // worth having at all.
    expect(tankWindows(edit(typo, 'f2', { odometer: 1400 })).map((w) => w.efficiency)).toEqual([
      10, 10,
    ]);
  });

  it('re-measures the enclosing window when litres are corrected', () => {
    // 40 L mistyped as 4.0 makes the tank read as 100 km/L.
    const typo = edit(log, 'f2', { litres: 4 });
    expect(tankWindows(typo)[0].efficiency).toBe(100);
    expect(tankWindows(edit(typo, 'f2', { litres: 40 }))[0].efficiency).toBe(10);
  });

  it('turns two windows into one longer one when a middle fill is deleted', () => {
    // The claim the delete confirmation makes: the figures either side change.
    const after = tankWindows(remove(log, 'f2'));
    expect(after).toHaveLength(1);
    expect(after[0].distance).toBe(800);
    // 800 km on the 40 L of the closing fill — the deleted tank's litres are
    // gone with it, so the survivor reads high. Deleting is not free.
    expect(after[0].efficiency).toBe(20);
  });

  it('loses only the last window when the newest fill is deleted', () => {
    const after = tankWindows(remove(log, 'f3'));
    expect(after).toHaveLength(1);
    expect(after[0].efficiency).toBe(10);
  });

  it('leaves every window intact when the oldest fill is deleted', () => {
    // The first fill only ever anchored a window; removing it drops that
    // anchor, not any measured figure after it.
    const after = tankWindows(remove(log, 'f1'));
    expect(after).toHaveLength(1);
    expect(after[0].efficiency).toBe(10);
  });

  it('stops reporting a window once a fill is marked part-fill', () => {
    // Flipping the switch on an edit is a real correction, not a no-op: a
    // part-fill cannot close a window, it folds into the next one.
    const after = tankWindows(edit(log, 'f2', { isFullTank: false }));
    expect(after).toHaveLength(1);
    expect(after[0].distance).toBe(800);
  });

  it('breaks the chain when a missed fill-up is recorded on an edit', () => {
    const after = tankWindows(edit(log, 'f2', { missedPrevious: true }));
    // The window that would have spanned the unlogged fuel is withheld rather
    // than published as a flattering figure.
    expect(after).toHaveLength(1);
    expect(after[0].efficiency).toBe(10);
  });
});
