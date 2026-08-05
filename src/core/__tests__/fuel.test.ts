import { describe, expect, it } from 'vitest';
import {
  distanceSinceService,
  fuelStats,
  litresPer100,
  serviceDue,
  tankWindows,
  type FuelFill,
} from '../fuel';

/**
 * Consumption maths.
 *
 * Real economy can only be measured between two BRIM-FULL tanks: fill, drive,
 * fill again, and the litres that went in the second time are exactly what the
 * distance cost. Everything below is a consequence of that, and every case is
 * one an honest log actually produces.
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

describe('tank-to-tank windows', () => {
  /**
   * The first fill closes nothing.
   *
   * There is no earlier full tank to measure from, so reporting anything here
   * would be reporting the tank size as consumption — the classic bug in this
   * kind of app.
   */
  it('reports no window for a single fill', () => {
    expect(tankWindows([fill('1', 10_000, 40)])).toEqual([]);
  });

  /** The basic case: 400 km on 40 litres is 10 km/l. */
  it('measures between two full tanks', () => {
    const windows = tankWindows([fill('1', 10_000, 40), fill('2', 10_400, 40)]);

    expect(windows).toHaveLength(1);
    expect(windows[0].distance).toBe(400);
    expect(windows[0].litres).toBe(40);
    expect(windows[0].efficiency).toBe(10);
  });

  /**
   * A partial fill has no anchor of its own, but its litres were still burned —
   * so they belong to the window that encloses them.
   *
   * Ignoring them would overstate economy (distance credited, fuel forgotten);
   * treating the partial as its own window would report a wild figure against a
   * few kilometres.
   */
  it('folds a partial fill into the enclosing window', () => {
    const windows = tankWindows([
      fill('1', 10_000, 40),
      fill('2', 10_200, 10, { isFullTank: false }),
      fill('3', 10_500, 40),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0].distance).toBe(500);
    // 10 from the partial + 40 at the close.
    expect(windows[0].litres).toBe(50);
    expect(windows[0].efficiency).toBe(10);
  });

  /** Several complete windows are each reported. */
  it('reports one window per completed tank', () => {
    const windows = tankWindows([
      fill('1', 10_000, 40),
      fill('2', 10_400, 40),
      fill('3', 10_900, 50),
    ]);

    expect(windows.map((w) => w.distance)).toEqual([400, 500]);
    expect(windows.map((w) => w.efficiency)).toEqual([10, 10]);
  });

  /**
   * A known-missed fill-up breaks the chain.
   *
   * The distance is real but the litres are not — fuel went in that was never
   * logged — so the ratio would flatter the vehicle. Better to drop the window
   * than publish a figure that is quietly wrong.
   */
  it('drops the window across a missed fill-up', () => {
    const windows = tankWindows([
      fill('1', 10_000, 40),
      fill('2', 10_800, 40, { missedPrevious: true }),
      fill('3', 11_200, 40),
    ]);

    // Only the window AFTER the break survives.
    expect(windows).toHaveLength(1);
    expect(windows[0].distance).toBe(400);
  });

  /**
   * Odometer order, not date order.
   *
   * A receipt entered late has a truthful reading and a misleading timestamp;
   * distance is what the maths needs, so the odometer decides.
   */
  it('orders by odometer even when dates disagree', () => {
    const windows = tankWindows([
      fill('1', 10_400, 40, { filledAt: day(1) }),
      fill('2', 10_000, 40, { filledAt: day(9) }),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0].distance).toBe(400);
  });

  /** A mistyped reading must not produce a negative or absurd figure. */
  it('skips a window whose odometer did not advance', () => {
    expect(tankWindows([fill('1', 10_000, 40), fill('2', 10_000, 40)])).toEqual([]);
  });

  /** Zero litres is a mis-entry; dividing by it would be infinite. */
  it('skips a window with no litres', () => {
    expect(tankWindows([fill('1', 10_000, 40), fill('2', 10_400, 0)])).toEqual([]);
  });

  /** A log with only partial fills can never close a window. */
  it('reports nothing when no tank was ever filled', () => {
    const windows = tankWindows([
      fill('1', 10_000, 10, { isFullTank: false }),
      fill('2', 10_200, 10, { isFullTank: false }),
    ]);

    expect(windows).toEqual([]);
  });
});

describe('fuelStats', () => {
  const log = [
    fill('1', 10_000, 40, { totalMinor: 800_000 }),
    fill('2', 10_400, 40, { totalMinor: 800_000 }),
    fill('3', 11_000, 50, { totalMinor: 1_000_000 }),
  ];

  it('reports the latest window as "this tank"', () => {
    // 600 km on 50 L.
    expect(fuelStats(log).latestEfficiency).toBe(12);
  });

  /**
   * The lifetime figure is distance ÷ litres, NOT the mean of the per-window
   * ratios — a 40 km tank and a 600 km one are not equally informative, and
   * averaging the ratios lets one short tank swing the number.
   */
  it('weights the lifetime average by distance', () => {
    const stats = fuelStats(log);

    expect(stats.totalDistance).toBe(1000);
    expect(stats.totalLitres).toBe(90);
    expect(stats.averageEfficiency).toBeCloseTo(1000 / 90, 6);
  });

  it('reports best and worst tanks', () => {
    const stats = fuelStats(log);

    expect(stats.bestEfficiency).toBe(12);
    expect(stats.worstEfficiency).toBe(10);
  });

  it('derives cost per unit distance from measured windows', () => {
    const stats = fuelStats(log);

    // Only the two CLOSING fills are inside windows: 800,000 + 1,000,000.
    expect(stats.totalCostMinor).toBe(1_800_000);
    expect(stats.costPerDistanceMinor).toBe(1800);
  });

  /**
   * One unpriced fill makes the total unknowable rather than smaller. A partial
   * sum presented as the whole would understate spend.
   */
  it('reports cost as unknown when any fill in a window is unpriced', () => {
    const stats = fuelStats([
      fill('1', 10_000, 40, { totalMinor: 800_000 }),
      fill('2', 10_400, 40),
    ]);

    expect(stats.totalCostMinor).toBeNull();
    expect(stats.costPerDistanceMinor).toBeNull();
  });

  /** Litres BOUGHT is a different question from litres measured. */
  it('counts every logged litre, including outside windows', () => {
    // The first fill opens a window and so contributes no measured litres.
    expect(fuelStats(log).litresLogged).toBe(130);
    expect(fuelStats(log).totalLitres).toBe(90);
  });

  /**
   * The dates behind best/worst, so the UI can say WHEN a figure happened.
   * A best tank from eight months ago says something different about a vehicle
   * than one from last week.
   */
  it('reports when the best and worst tanks happened', () => {
    const stats = fuelStats(log);

    // Window 2 (closing fill '3') is the best at 12 km/l.
    expect(stats.bestAt).toEqual(day(3));
    // Window 1 (closing fill '2') is the worst at 10 km/l.
    expect(stats.worstAt).toEqual(day(2));
  });

  it('reports the span the average covers', () => {
    const stats = fuelStats(log);

    expect(stats.firstAt).toEqual(day(2));
    expect(stats.latestAt).toEqual(day(3));
  });

  it('reports the current odometer from the furthest reading', () => {
    expect(fuelStats(log).latestOdometer).toBe(11_000);
  });

  /** An empty log must report absence, not zeroes that look like data. */
  it('reports nulls for an empty log', () => {
    const stats = fuelStats([]);

    expect(stats.windowCount).toBe(0);
    expect(stats.latestEfficiency).toBeNull();
    expect(stats.averageEfficiency).toBeNull();
    expect(stats.latestOdometer).toBeNull();
    expect(stats.bestAt).toBeNull();
    expect(stats.worstAt).toBeNull();
  });

  /** A vehicle with one fill knows its odometer but not its economy. */
  it('reports an odometer but no economy from a single fill', () => {
    const stats = fuelStats([fill('1', 10_000, 40)]);

    expect(stats.latestOdometer).toBe(10_000);
    expect(stats.averageEfficiency).toBeNull();
  });
});

describe('litresPer100', () => {
  it('inverts efficiency into the European reading', () => {
    expect(litresPer100(10)).toBe(10);
    expect(litresPer100(20)).toBe(5);
  });

  it('returns null when there is no efficiency to invert', () => {
    expect(litresPer100(null)).toBeNull();
    expect(litresPer100(0)).toBeNull();
  });
});

describe('serviceDue', () => {
  const today = new Date(2026, 0, 15);

  it('counts down by distance', () => {
    const due = serviceDue({ id: 's', servicedAt: day(1), nextDueOdometer: 15_000 }, 13_500, today);

    expect(due.distanceRemaining).toBe(1500);
    expect(due.overdue).toBe(false);
  });

  it('flags an overdue distance', () => {
    const due = serviceDue({ id: 's', servicedAt: day(1), nextDueOdometer: 13_000 }, 13_500, today);

    expect(due.distanceRemaining).toBe(-500);
    expect(due.overdue).toBe(true);
  });

  it('counts down by date', () => {
    const due = serviceDue(
      { id: 's', servicedAt: day(1), nextDueDate: new Date(2026, 0, 25) },
      null,
      today,
    );

    expect(due.daysRemaining).toBe(10);
    expect(due.overdue).toBe(false);
  });

  /**
   * "Every 5,000 km or 6 months, whichever comes first" is how every service
   * book words it, so either measure alone raises the warning.
   */
  it('is overdue when either measure has passed', () => {
    const due = serviceDue(
      {
        id: 's',
        servicedAt: day(1),
        nextDueOdometer: 20_000,
        nextDueDate: new Date(2026, 0, 10),
      },
      13_500,
      today,
    );

    expect(due.distanceRemaining).toBe(6500);
    expect(due.overdue).toBe(true);
  });

  it('reports nulls when neither measure is set', () => {
    const due = serviceDue({ id: 's', servicedAt: day(1) }, 13_500, today);

    expect(due.distanceRemaining).toBeNull();
    expect(due.daysRemaining).toBeNull();
    expect(due.overdue).toBe(false);
  });
});

describe('distanceSinceService', () => {
  it('measures from the most recent service with a reading', () => {
    const distance = distanceSinceService(
      [
        { id: 'a', servicedAt: day(1), odometer: 9_000 },
        { id: 'b', servicedAt: day(5), odometer: 12_000 },
      ],
      13_500,
    );

    expect(distance).toBe(1500);
  });

  /** Absent, not zero — a reminder that cannot be computed must read as such. */
  it('returns null when no service recorded an odometer', () => {
    expect(distanceSinceService([{ id: 'a', servicedAt: day(1) }], 13_500)).toBeNull();
    expect(distanceSinceService([], 13_500)).toBeNull();
  });

  it('returns null when the current odometer is unknown', () => {
    expect(distanceSinceService([{ id: 'a', servicedAt: day(1), odometer: 9_000 }], null)).toBeNull();
  });
});
