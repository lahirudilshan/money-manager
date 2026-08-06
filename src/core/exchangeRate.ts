/**
 * The USD exchange rate: which figure the board actually uses, and why.
 *
 * ## Three rates, not one
 *
 * A single stored number cannot serve the two things this app does with it:
 *
 *   - **live** — what a dollar is worth today. Right for converting an inward
 *     SWIFT credit that already landed, because the bank used roughly that.
 *   - **safe** — a deliberately conservative figure the user sets. Right for
 *     PLANNING against future dollar income, where being optimistic means
 *     budgeting money that may not arrive. Someone paid in USD who plans at the
 *     spot rate is over-committed the moment the rupee strengthens.
 *   - **average** — the mean of recent live readings, which smooths a single
 *     unusual day without needing the user to judge anything.
 *
 * Keeping all three and letting the user pick which one the board uses is the
 * whole point; auto-fetching only makes the live figure current.
 *
 * Pure functions over plain data, so the policy is testable without a network.
 */

/** One observed rate, as stored in settings. */
export interface RatePoint {
  /** Home-currency units per 1 USD. */
  rate: number;
  /** ISO timestamp the reading was taken. */
  at: string;
}

/** Which figure the board converts with. */
export type RateMode =
  /** Whatever was last fetched — tracks reality, moves daily. */
  | 'live'
  /** The average of recent readings — smooths a single odd day. */
  | 'average'
  /** The user's own conservative figure — never moves unless they change it. */
  | 'safe';

/**
 * How many readings to keep.
 *
 * Thirty is about a month of daily fetches: enough for an average to mean
 * something, short enough that a rate from a very different economic moment
 * does not drag the mean. Storage is trivial either way — this is a list of
 * numbers in a settings row.
 */
export const MAX_RATE_HISTORY = 30;

/**
 * Add a reading, newest first, keeping at most one per day.
 *
 * Same-day de-duplication matters because the app fetches on launch: opening it
 * five times in a morning would otherwise fill the history with five nearly
 * identical numbers and skew the average toward whatever today happens to be.
 */
export function recordRate(
  history: readonly RatePoint[],
  rate: number,
  now = new Date(),
): RatePoint[] {
  if (!Number.isFinite(rate) || rate <= 0) return [...history];

  const today = now.toISOString().slice(0, 10);
  const withoutToday = history.filter((point) => point.at.slice(0, 10) !== today);

  return [{ rate, at: now.toISOString() }, ...withoutToday].slice(0, MAX_RATE_HISTORY);
}

/** The mean of the stored readings, or null when there are none. */
export function averageRate(history: readonly RatePoint[]): number | null {
  if (history.length === 0) return null;

  const total = history.reduce((sum, point) => sum + point.rate, 0);
  return Math.round((total / history.length) * 100) / 100;
}

/** The most recent reading, or null. */
export function latestRate(history: readonly RatePoint[]): number | null {
  return history[0]?.rate ?? null;
}

/**
 * The rate the board should actually use.
 *
 * Every mode falls back rather than returning nothing: a board that cannot
 * convert is worse than one converting with a slightly stale figure, and the
 * user always has `manualRate` as the floor.
 */
export function effectiveRate(options: {
  mode: RateMode;
  history: readonly RatePoint[];
  /** The user's typed figure — the safe rate, and the ultimate fallback. */
  manualRate: number;
}): number {
  const { mode, history, manualRate } = options;

  if (mode === 'safe') return manualRate;

  if (mode === 'average') {
    return averageRate(history) ?? manualRate;
  }

  return latestRate(history) ?? manualRate;
}

/**
 * Whether a fetch is due.
 *
 * Once a day is the right cadence: published rates move on a daily cycle, and
 * refetching on every launch would spend the user's data to redraw the same
 * number. A missing or unparseable timestamp reads as "never fetched", which
 * makes the first launch after enabling this fetch immediately.
 */
export function isFetchDue(lastFetchedAt: string | null | undefined, now = new Date()): boolean {
  if (!lastFetchedAt) return true;

  const last = Date.parse(lastFetchedAt);
  if (!Number.isFinite(last)) return true;

  return now.getTime() - last >= 24 * 60 * 60 * 1000;
}

/**
 * How far the live rate has drifted from the safe one, as a percentage.
 *
 * Shown so a user who set a safe rate months ago can see it has fallen out of
 * touch — a "safe" figure 20% below spot is not conservative, it is wrong, and
 * nothing else on the screen would tell them.
 */
export function driftPercent(live: number | null, safe: number): number | null {
  if (live === null || !Number.isFinite(safe) || safe <= 0) return null;

  return Math.round(((live - safe) / safe) * 1000) / 10;
}

/** Parse the stored history, tolerating anything that is not what we wrote. */
export function parseHistory(stored: string | null | undefined): RatePoint[] {
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (point): point is RatePoint =>
        point !== null &&
        typeof point === 'object' &&
        typeof point.rate === 'number' &&
        point.rate > 0 &&
        typeof point.at === 'string',
    );
  } catch {
    return [];
  }
}

export function serialiseHistory(history: readonly RatePoint[]): string {
  return JSON.stringify(history);
}
