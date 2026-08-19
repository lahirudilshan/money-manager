/**
 * Real fuel consumption, from a log of fill-ups.
 *
 * The whole feature rests on one idea: you can only know how much fuel a
 * journey burned if you know the tank was BRIM FULL at both ends of it. Fill to
 * full, drive, fill to full again — the litres that went in the second time are
 * exactly what the distance between them cost. That is a tank-to-tank window,
 * and it is the only honest per-fill figure there is.
 *
 * Everything awkward about these apps follows from that:
 *
 *   - a PARTIAL fill has no anchor, so it cannot end a window. Its litres are
 *     not discarded though — they went into the same tank — so they are carried
 *     into the next full-tank window instead. An app that ignores them
 *     understates consumption; one that treats each partial as its own window
 *     reports nonsense like 4 km/l.
 *   - the FIRST fill of a vehicle's life closes no window. There is nothing
 *     before it to measure from, and reporting the tank size as "consumption"
 *     is the classic bug here.
 *   - a MISSED fill-up breaks the chain. The driver knows they forgot; the odo
 *     gap is real but the litres are not, so the window must be dropped rather
 *     than reported as a suspiciously good tank.
 *
 * Pure functions over plain arrays — no database, no store — so every rule
 * above is unit tested without a device.
 */

import type { Minor } from '~/shared/lib/money';

/** The minimum a fill-up needs for the maths. Matches the `fuel_entries` row. */
export interface FuelFill {
  id: string;
  /** Odometer at the pump, in the vehicle's unit. */
  odometer: number;
  litres: number;
  /** Filled to the brim — the flag that lets a window close here. */
  isFullTank: boolean;
  /** The driver knows a previous fill-up went unrecorded; breaks the chain. */
  missedPrevious?: boolean;
  filledAt: Date;
  /** What it cost, from the linked transaction or typed in for a cash fill. */
  totalMinor?: Minor | null;
}

/** One measured stretch between two full tanks. */
export interface TankWindow {
  /** The fill that CLOSED the window — the one the figure is reported against. */
  id: string;
  from: Date;
  to: Date;
  /** Distance covered, in the vehicle's odometer unit. */
  distance: number;
  /** Every litre that went in across the window, partials included. */
  litres: number;
  /** Distance per litre — the headline number. */
  efficiency: number;
  /** What the fuel for this stretch cost, when known. */
  costMinor: Minor | null;
}

/**
 * Sort fills into the order consumption is measured in.
 *
 * By ODOMETER, not by date. The two normally agree, but a fill-up entered late
 * — a receipt found in a pocket a week on — has a truthful odometer and a
 * misleading position in date order. Distance is what the maths needs, so the
 * odometer decides. Date breaks a tie, for two fills at the same reading.
 */
function inTravelOrder(fills: readonly FuelFill[]): FuelFill[] {
  return [...fills].sort(
    (a, b) => a.odometer - b.odometer || a.filledAt.getTime() - b.filledAt.getTime(),
  );
}

/**
 * Every complete tank-to-tank window in the log, oldest first.
 *
 * A window opens at a full tank and closes at the NEXT full tank, absorbing any
 * partial fills between them. Windows that cannot be trusted are skipped
 * rather than reported: see the guards inline.
 */
export function tankWindows(fills: readonly FuelFill[]): TankWindow[] {
  const ordered = inTravelOrder(fills);
  const windows: TankWindow[] = [];

  /** The last full tank, which is where the current window started. */
  let anchor: FuelFill | null = null;
  /** Litres burned since the anchor — partials plus the closing fill. */
  let litresSinceAnchor = 0;
  /** Cost of those same litres, or null once any of them is unpriced. */
  let costSinceAnchor: Minor | null = 0;

  for (const fill of ordered) {
    /*
     * A known-missed fill-up invalidates the window in progress.
     *
     * The distance is real but the litres are not — fuel went in that was never
     * logged — so the ratio would flatter the vehicle. Re-anchor here and start
     * again rather than publish a figure that is quietly wrong.
     */
    if (fill.missedPrevious) {
      anchor = fill.isFullTank ? fill : null;
      litresSinceAnchor = 0;
      costSinceAnchor = 0;
      continue;
    }

    if (anchor) {
      litresSinceAnchor += fill.litres;
      costSinceAnchor =
        costSinceAnchor === null || fill.totalMinor == null
          ? null
          : costSinceAnchor + fill.totalMinor;
    }

    if (!fill.isFullTank) continue;

    if (anchor) {
      const distance = fill.odometer - anchor.odometer;

      /*
       * Only publish a window that could physically have happened.
       *
       * A non-positive distance means the odometer was mistyped or the vehicle
       * was reset; zero litres means a mis-entry. Either way the division is
       * either impossible or produces an absurd number, and showing "9,999
       * km/l" once is enough to make the user distrust every other figure on
       * the screen.
       */
      if (distance > 0 && litresSinceAnchor > 0) {
        windows.push({
          id: fill.id,
          from: anchor.filledAt,
          to: fill.filledAt,
          distance,
          litres: litresSinceAnchor,
          efficiency: distance / litresSinceAnchor,
          costMinor: costSinceAnchor,
        });
      }
    }

    // This full tank anchors the next window.
    anchor = fill;
    litresSinceAnchor = 0;
    costSinceAnchor = 0;
  }

  return windows;
}

/** Headline numbers for one vehicle. Every field is null when unknowable. */
export interface FuelStats {
  /** Complete tank-to-tank windows found. Zero until the second full tank. */
  windowCount: number;
  /** The most recent window's efficiency — "this tank". */
  latestEfficiency: number | null;
  /**
   * Distance ÷ litres across every window.
   *
   * Weighted by distance rather than an average of the per-window figures: a
   * 40 km window and a 600 km one are not equally informative, and averaging
   * the ratios lets a single short tank swing the lifetime number.
   */
  averageEfficiency: number | null;
  bestEfficiency: number | null;
  worstEfficiency: number | null;
  /**
   * When the best and worst tanks happened.
   *
   * Carried alongside the figures because a bare "best 23.0" invites the
   * question "when was that?" — and the answer is what makes the number
   * actionable: a best tank from eight months ago says something different
   * about the vehicle than one from last week.
   */
  bestAt: Date | null;
  worstAt: Date | null;
  /** The window the average covers, so the figure has a stated period. */
  firstAt: Date | null;
  latestAt: Date | null;
  /** Distance covered across measured windows. */
  totalDistance: number;
  /** Litres burned across measured windows. */
  totalLitres: number;
  /** Every litre ever logged, windows or not — what the driver has bought. */
  litresLogged: number;
  /** Spend across measured windows, when every fill in them was priced. */
  totalCostMinor: Minor | null;
  /** Cost per unit distance, from the same windows. */
  costPerDistanceMinor: Minor | null;
  /** Highest odometer seen — the vehicle's current reading. */
  latestOdometer: number | null;
  /** Most recent fill, by odometer. */
  latestFill: FuelFill | null;
}

export function fuelStats(fills: readonly FuelFill[]): FuelStats {
  const ordered = inTravelOrder(fills);
  const windows = tankWindows(fills);

  const totalDistance = windows.reduce((sum, w) => sum + w.distance, 0);
  const totalLitres = windows.reduce((sum, w) => sum + w.litres, 0);
  const litresLogged = ordered.reduce((sum, f) => sum + f.litres, 0);

  // Null as soon as ONE window is unpriced: a partial total presented as the
  // whole would understate spend, which is worse than saying "not yet known".
  const totalCostMinor = windows.some((w) => w.costMinor === null)
    ? null
    : windows.reduce((sum, w) => sum + (w.costMinor ?? 0), 0);

  const efficiencies = windows.map((w) => w.efficiency);
  const best = windows.length > 0
    ? windows.reduce((a, b) => (b.efficiency > a.efficiency ? b : a))
    : null;
  const worst = windows.length > 0
    ? windows.reduce((a, b) => (b.efficiency < a.efficiency ? b : a))
    : null;

  return {
    windowCount: windows.length,
    latestEfficiency: windows.length > 0 ? windows[windows.length - 1].efficiency : null,
    averageEfficiency: totalLitres > 0 ? totalDistance / totalLitres : null,
    bestEfficiency: efficiencies.length > 0 ? Math.max(...efficiencies) : null,
    worstEfficiency: efficiencies.length > 0 ? Math.min(...efficiencies) : null,
    bestAt: best?.to ?? null,
    worstAt: worst?.to ?? null,
    firstAt: windows.length > 0 ? windows[0].to : null,
    latestAt: windows.length > 0 ? windows[windows.length - 1].to : null,
    totalDistance,
    totalLitres,
    litresLogged,
    totalCostMinor,
    costPerDistanceMinor:
      totalCostMinor !== null && totalDistance > 0
        ? Math.round(totalCostMinor / totalDistance)
        : null,
    latestOdometer: ordered.length > 0 ? ordered[ordered.length - 1].odometer : null,
    latestFill: ordered.length > 0 ? ordered[ordered.length - 1] : null,
  };
}

/**
 * Litres per 100 distance-units, the other way people read economy.
 *
 * Europe quotes L/100km and inverts the "bigger is better" relationship, so
 * both are offered rather than assuming which one the user thinks in.
 */
export function litresPer100(efficiency: number | null): number | null {
  if (efficiency === null || efficiency <= 0) return null;
  return 100 / efficiency;
}

/** A service record, reduced to what the due-date maths needs. */
export interface ServiceRecord {
  id: string;
  servicedAt: Date;
  odometer?: number | null;
  nextDueOdometer?: number | null;
  nextDueDate?: Date | null;
}

/** How close a service is to being due, for the reminder row. */
export interface ServiceDue {
  id: string;
  /** Distance still to run before it is due; null when not distance-based. */
  distanceRemaining: number | null;
  /** Days until due; null when not date-based. Negative once overdue. */
  daysRemaining: number | null;
  /** True when either measure has passed. */
  overdue: boolean;
}

/**
 * Work out what is due, from whichever measure the record carries.
 *
 * Both may be set — "every 5,000 km or 6 months, whichever comes first" is how
 * every service book words it — so whichever arrives sooner wins, and either
 * alone is enough to raise the warning.
 */
export function serviceDue(
  record: ServiceRecord,
  currentOdometer: number | null,
  today = new Date(),
): ServiceDue {
  const distanceRemaining =
    record.nextDueOdometer != null && currentOdometer != null
      ? record.nextDueOdometer - currentOdometer
      : null;

  const daysRemaining =
    record.nextDueDate != null
      ? Math.ceil((record.nextDueDate.getTime() - today.getTime()) / 86_400_000)
      : null;

  return {
    id: record.id,
    distanceRemaining,
    daysRemaining,
    overdue: (distanceRemaining !== null && distanceRemaining <= 0) ||
      (daysRemaining !== null && daysRemaining <= 0),
  };
}

/**
 * Distance driven since the last service that recorded an odometer.
 *
 * Null when no service has one, which is the common case early on — a reminder
 * that cannot be computed should read as absent rather than as zero.
 */
export function distanceSinceService(
  services: readonly ServiceRecord[],
  currentOdometer: number | null,
): number | null {
  if (currentOdometer == null) return null;

  const withOdometer = services
    .filter((s): s is ServiceRecord & { odometer: number } => s.odometer != null)
    .sort((a, b) => b.odometer - a.odometer);

  if (withOdometer.length === 0) return null;

  const distance = currentOdometer - withOdometer[0].odometer;
  return distance >= 0 ? distance : null;
}
