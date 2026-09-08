/**
 * Shaping a line's month-by-month spend for a small bar chart.
 *
 * Pure maths, kept out of the component so the awkward parts — an empty
 * history, a single month, a budget far above or below everything actually
 * spent — are testable without rendering anything.
 *
 * The design rule throughout: a chart must not imply a trend it cannot support.
 * One month is a number, not a history, so this reports that rather than
 * drawing a lone bar the eye reads as a pattern.
 */

import type { Minor } from '~/shared/lib/money';

/** One month's spend on a line. */
export interface MonthlySpend {
  /** "2026-09". */
  period: string;
  totalMinor: Minor;
}

/** A bar, ready to draw. */
export interface HistoryBar extends MonthlySpend {
  /** Height as a fraction of the tallest bar, 0-1. */
  fraction: number;
  /** Short month label ("Sep"), derived from the period. */
  label: string;
  /** Whether this month exceeded the budget, when one is set. */
  overBudget: boolean;
  /**
   * How this month sits against the AVERAGE of the window.
   *
   * The chart's own comparison, and the one that colours the bars: "above",
   * "about" or "below" what this bill usually costs. A 5% band counts as
   * typical, because a bill that lands a rupee either side of the mean is not
   * a month worth flagging — without it, half of every history would be red on
   * arithmetic alone.
   */
  vsAverage: 'above' | 'about' | 'below';
  /** The month being viewed, which the chart highlights. */
  current: boolean;
  /**
   * Change against the month before it, in minor units — null for the first
   * bar, which has nothing before it to compare with.
   *
   * Held as an ABSOLUTE amount rather than only a percentage: on a small bill a
   * 40% jump can be a hundred rupees, and the money is what the user acts on.
   */
  changeMinor: Minor | null;
  /** The same change as a percentage, or null when the previous month was 0. */
  changePct: number | null;
}

/**
 * The fewest months worth charting.
 *
 * Two, because a chart's only job here is comparison and one bar compares with
 * nothing. Below this the caller renders no chart at all rather than a near
 * empty panel — a bill in its first month should look finished, not broken.
 */
export const MIN_MONTHS_FOR_CHART = 2;

/** "2026-09" to "Sep". Falls back to the raw period if it is not a month key. */
export function monthLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return period;

  // Fixed English abbreviations rather than `toLocaleString`: the axis has room
  // for three characters, and some locales render a full word or a bare digit.
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    monthIndex
  ];
}

/**
 * Scale months into bars, or return an empty list when there is nothing to say.
 *
 * Heights are relative to the tallest month rather than to the budget, so an
 * unusually expensive month is visible as the outlier it is instead of pinning
 * every bar to the top of the chart. The budget is drawn as a separate
 * reference line (see `budgetFraction`), which is what makes over/under
 * readable without turning the bars into a percentage.
 */
export function historyBars(
  months: readonly MonthlySpend[],
  options: { budgetMinor?: Minor | null; currentPeriod?: string } = {},
): HistoryBar[] {
  if (months.length < MIN_MONTHS_FOR_CHART) return [];

  const { budgetMinor = null, currentPeriod } = options;
  const peak = Math.max(...months.map((month) => month.totalMinor), 0);
  const mean = months.reduce((sum, m) => sum + m.totalMinor, 0) / months.length;
  /** Within 5% of the mean reads as an ordinary month, not a deviation. */
  const band = mean * 0.05;

  return months.map((month, index) => {
    const previous = index > 0 ? months[index - 1] : null;
    /*
     * A percentage needs something to be a percentage OF. A month following one
     * that spent nothing has no meaningful rate of change — "infinity percent"
     * — so only the absolute amount is reported there.
     */
    const changeMinor = previous ? month.totalMinor - previous.totalMinor : null;
    const changePct =
      previous && previous.totalMinor > 0
        ? Math.round(((month.totalMinor - previous.totalMinor) / previous.totalMinor) * 100)
        : null;

    return {
      ...month,
      // A peak of zero would divide by zero; every bar is then legitimately flat.
      fraction: peak > 0 ? month.totalMinor / peak : 0,
      label: monthLabel(month.period),
      overBudget: budgetMinor !== null && budgetMinor > 0 && month.totalMinor > budgetMinor,
      current: month.period === currentPeriod,
      vsAverage:
        month.totalMinor > mean + band
          ? ('above' as const)
          : month.totalMinor < mean - band
            ? ('below' as const)
            : ('about' as const),
      changeMinor,
      changePct,
    };
  });
}

/**
 * Where the budget line sits, as a fraction of the chart's height.
 *
 * Null when it should not be drawn: no budget set, or a budget so far above
 * every month that the line would sit at the very top and squash the bars into
 * the floor. In that case the bars alone tell the story — nothing came close.
 */
export function budgetFraction(
  months: readonly MonthlySpend[],
  budgetMinor: Minor | null | undefined,
): number | null {
  if (!budgetMinor || budgetMinor <= 0) return null;

  const peak = Math.max(...months.map((month) => month.totalMinor), 0);
  if (peak <= 0) return null;

  const fraction = budgetMinor / peak;
  // More than double the worst month: drawing it would make every bar unreadable.
  return fraction > 2 ? null : Math.min(fraction, 1);
}

/**
 * How this month compares with the months before it.
 *
 * Deliberately against the AVERAGE of the earlier months rather than only the
 * previous one: a single cheap or expensive month would otherwise flip the
 * verdict and report a trend that is really just noise.
 *
 * Null when there is nothing to compare against, or when the earlier months
 * total zero — a percentage change from nothing is meaningless, not infinite.
 */
export function changeVsAverage(months: readonly MonthlySpend[]): number | null {
  if (months.length < MIN_MONTHS_FOR_CHART) return null;

  const previous = months.slice(0, -1);
  const latest = months[months.length - 1];

  const average = previous.reduce((sum, m) => sum + m.totalMinor, 0) / previous.length;
  if (average <= 0) return null;

  return Math.round(((latest.totalMinor - average) / average) * 100);
}

/**
 * Where the AVERAGE sits, as a fraction of the chart's height.
 *
 * Drawn inside the plot so "is this month normal?" is answered by looking at
 * the bars against a line, rather than by reading a figure in a separate panel
 * and holding it in mind while looking back at the chart.
 *
 * Always drawable when there is history: the mean of a set of bars can never
 * exceed the tallest of them, so unlike the budget it cannot squash the plot.
 */
export function averageFraction(months: readonly MonthlySpend[]): number | null {
  if (months.length < MIN_MONTHS_FOR_CHART) return null;

  const peak = Math.max(...months.map((month) => month.totalMinor), 0);
  if (peak <= 0) return null;

  const mean = months.reduce((sum, m) => sum + m.totalMinor, 0) / months.length;
  return mean / peak;
}

/**
 * The plain-language summary under the chart.
 *
 * Says the three things a person actually asks of a recurring bill — the usual
 * figure, this month against it, and the range it moves in — so the chart is
 * readable without measuring bars by eye.
 *
 * `null` when there is not enough history to say any of it honestly.
 */
export interface HistorySummary {
  /** Mean of every month shown, including the current one. */
  averageMinor: Minor;
  /** Cheapest and dearest months in the window. */
  lowMinor: Minor;
  highMinor: Minor;
  /** This month against the mean of the EARLIER months. */
  vsAverageMinor: Minor;
  vsAveragePct: number | null;
}

export function historySummary(months: readonly MonthlySpend[]): HistorySummary | null {
  if (months.length < MIN_MONTHS_FOR_CHART) return null;

  const amounts = months.map((month) => month.totalMinor);
  const latest = months[months.length - 1].totalMinor;
  const earlier = months.slice(0, -1);
  const earlierMean = earlier.reduce((sum, m) => sum + m.totalMinor, 0) / earlier.length;

  return {
    averageMinor: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
    lowMinor: Math.min(...amounts),
    highMinor: Math.max(...amounts),
    vsAverageMinor: Math.round(latest - earlierMean),
    vsAveragePct:
      earlierMean > 0 ? Math.round(((latest - earlierMean) / earlierMean) * 100) : null,
  };
}
