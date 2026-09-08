import { describe, expect, it } from 'vitest';
import {
  MIN_MONTHS_FOR_CHART,
  averageFraction,
  budgetFraction,
  changeVsAverage,
  historyBars,
  historySummary,
  monthLabel,
} from '../spendHistory';

/**
 * The month-by-month chart on a bill.
 *
 * The rule under test throughout: never imply a trend the data cannot support.
 * One month is a number, not a history — drawing a lone bar invites the eye to
 * read a pattern that is not there.
 */

const MONTHS = [
  { period: '2026-07', totalMinor: 8_000_00 },
  { period: '2026-08', totalMinor: 6_000_00 },
  { period: '2026-09', totalMinor: 10_000_00 },
];

describe('month labels', () => {
  it('shortens a period to a month name', () => {
    expect(monthLabel('2026-09')).toBe('Sep');
    expect(monthLabel('2026-01')).toBe('Jan');
    expect(monthLabel('2026-12')).toBe('Dec');
  });

  it('passes through anything that is not a month key', () => {
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(monthLabel('2026-13')).toBe('2026-13');
    expect(monthLabel('2026-00')).toBe('2026-00');
  });
});

describe('deciding whether to draw at all', () => {
  it('draws nothing for a single month', () => {
    // The user's Electricity line today: real data, but nothing to compare to.
    expect(historyBars([MONTHS[0]])).toEqual([]);
  });

  it('draws nothing for an empty history', () => {
    expect(historyBars([])).toEqual([]);
  });

  it('draws once there are two months', () => {
    expect(historyBars(MONTHS.slice(0, MIN_MONTHS_FOR_CHART))).toHaveLength(2);
  });
});

describe('scaling the bars', () => {
  it('makes the tallest month full height and scales the rest to it', () => {
    const bars = historyBars(MONTHS);
    expect(bars.map((b) => b.fraction)).toEqual([0.8, 0.6, 1]);
  });

  it('marks the month being viewed', () => {
    const bars = historyBars(MONTHS, { currentPeriod: '2026-09' });
    expect(bars.map((b) => b.current)).toEqual([false, false, true]);
  });

  it('flags the months that went over budget', () => {
    const bars = historyBars(MONTHS, { budgetMinor: 7_000_00 });
    expect(bars.map((b) => b.overBudget)).toEqual([true, false, true]);
  });

  it('flags nothing when no budget is set', () => {
    expect(historyBars(MONTHS).every((b) => !b.overBudget)).toBe(true);
    expect(historyBars(MONTHS, { budgetMinor: 0 }).every((b) => !b.overBudget)).toBe(true);
  });

  it('survives a history of zeroes without dividing by zero', () => {
    const zeroes = [
      { period: '2026-08', totalMinor: 0 },
      { period: '2026-09', totalMinor: 0 },
    ];
    expect(historyBars(zeroes).map((b) => b.fraction)).toEqual([0, 0]);
  });
});

describe('the budget reference line', () => {
  it('sits proportionally against the tallest month', () => {
    expect(budgetFraction(MONTHS, 5_000_00)).toBe(0.5);
  });

  it('is not drawn when no budget is set', () => {
    expect(budgetFraction(MONTHS, null)).toBeNull();
    expect(budgetFraction(MONTHS, 0)).toBeNull();
  });

  it('is not drawn when it dwarfs every month', () => {
    /*
     * A budget more than twice the worst month would pin the line to the top
     * and squash every bar into the floor. The bars alone say enough: nothing
     * came close.
     */
    expect(budgetFraction(MONTHS, 50_000_00)).toBeNull();
  });

  it('is clamped to the top when the budget is only just above the peak', () => {
    expect(budgetFraction(MONTHS, 12_000_00)).toBe(1);
  });

  it('is not drawn against a history of zeroes', () => {
    expect(budgetFraction([{ period: '2026-09', totalMinor: 0 }], 5_000_00)).toBeNull();
  });
});

describe('comparing this month with the ones before', () => {
  it('reports the change against the AVERAGE, not just last month', () => {
    // 8,000 and 6,000 average 7,000; 10,000 is ~43% above it. Comparing only
    // with August (6,000) would have claimed +67% off one cheap month.
    expect(changeVsAverage(MONTHS)).toBe(43);
  });

  it('reports a fall as a negative', () => {
    expect(
      changeVsAverage([
        { period: '2026-08', totalMinor: 10_000_00 },
        { period: '2026-09', totalMinor: 5_000_00 },
      ]),
    ).toBe(-50);
  });

  it('says nothing with only one month', () => {
    expect(changeVsAverage([MONTHS[0]])).toBeNull();
  });

  it('says nothing when the earlier months spent nothing', () => {
    // A percentage change from zero is meaningless, not infinite.
    expect(
      changeVsAverage([
        { period: '2026-08', totalMinor: 0 },
        { period: '2026-09', totalMinor: 5_000_00 },
      ]),
    ).toBeNull();
  });
});

describe('month-on-month change per bar', () => {
  it('reports the amount and the percentage against the previous month', () => {
    const bars = historyBars(MONTHS);
    // Jul is first, so it has nothing behind it.
    expect(bars[0].changeMinor).toBeNull();
    expect(bars[0].changePct).toBeNull();
    // Aug: 6,000 from 8,000 = -2,000, -25%.
    expect(bars[1].changeMinor).toBe(-2_000_00);
    expect(bars[1].changePct).toBe(-25);
    // Sep: 10,000 from 6,000 = +4,000, +67%.
    expect(bars[2].changeMinor).toBe(4_000_00);
    expect(bars[2].changePct).toBe(67);
  });

  it('gives the amount but no percentage after a month that spent nothing', () => {
    /*
     * A rate of change from zero is not "infinity percent", it is undefined.
     * The money moved though, and that is still worth stating.
     */
    const bars = historyBars([
      { period: '2026-08', totalMinor: 0 },
      { period: '2026-09', totalMinor: 5_000_00 },
    ]);
    expect(bars[1].changeMinor).toBe(5_000_00);
    expect(bars[1].changePct).toBeNull();
  });
});

describe('the summary under the chart', () => {
  it('reports the average, the range, and this month against the rest', () => {
    const summary = historySummary(MONTHS)!;
    // (8,000 + 6,000 + 10,000) / 3 = 8,000.
    expect(summary.averageMinor).toBe(8_000_00);
    expect(summary.lowMinor).toBe(6_000_00);
    expect(summary.highMinor).toBe(10_000_00);
    // 10,000 against the 7,000 mean of Jul+Aug = +3,000, +43%.
    expect(summary.vsAverageMinor).toBe(3_000_00);
    expect(summary.vsAveragePct).toBe(43);
  });

  it('says nothing with only one month', () => {
    expect(historySummary([MONTHS[0]])).toBeNull();
    expect(historySummary([])).toBeNull();
  });

  it('reports a fall as a negative amount', () => {
    const summary = historySummary([
      { period: '2026-08', totalMinor: 10_000_00 },
      { period: '2026-09', totalMinor: 4_000_00 },
    ])!;
    expect(summary.vsAverageMinor).toBe(-6_000_00);
    expect(summary.vsAveragePct).toBe(-60);
  });

  it('omits the percentage when the earlier months spent nothing', () => {
    const summary = historySummary([
      { period: '2026-08', totalMinor: 0 },
      { period: '2026-09', totalMinor: 4_000_00 },
    ])!;
    expect(summary.vsAverageMinor).toBe(4_000_00);
    expect(summary.vsAveragePct).toBeNull();
  });
});

describe('the average reference line', () => {
  it('sits at the mean, as a fraction of the tallest month', () => {
    // Mean of 8,000/6,000/10,000 is 8,000; the peak is 10,000.
    expect(averageFraction(MONTHS)).toBeCloseTo(0.8, 10);
  });

  it('can never exceed the plot, unlike the budget line', () => {
    // A mean cannot be larger than the largest value, so this is always
    // drawable — which is why it needs no "too tall to draw" guard.
    for (const set of [MONTHS, MONTHS.slice(0, 2), [...MONTHS].reverse()]) {
      const fraction = averageFraction(set)!;
      expect(fraction).toBeGreaterThan(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it('is not drawn without enough history', () => {
    expect(averageFraction([MONTHS[0]])).toBeNull();
    expect(averageFraction([])).toBeNull();
  });

  it('is not drawn against a history of zeroes', () => {
    expect(
      averageFraction([
        { period: '2026-08', totalMinor: 0 },
        { period: '2026-09', totalMinor: 0 },
      ]),
    ).toBeNull();
  });
});

describe('classifying a month against the average', () => {
  it('marks months above, about, and below the mean', () => {
    // Mean of 8,000/6,000/10,000 is 8,000, with a 5% band of +/-400.
    expect(historyBars(MONTHS).map((b) => b.vsAverage)).toEqual(['about', 'below', 'above']);
  });

  it('treats a month within 5% of the mean as ordinary', () => {
    /*
     * Without the band, half of every history is red on arithmetic alone —
     * a bill landing a rupee above its own average is not a month to flag.
     */
    const flat = [
      { period: '2026-07', totalMinor: 10_000_00 },
      { period: '2026-08', totalMinor: 10_200_00 },
      { period: '2026-09', totalMinor: 9_800_00 },
    ];
    expect(historyBars(flat).every((b) => b.vsAverage === 'about')).toBe(true);
  });

  it('classifies by the AVERAGE, not the budget', () => {
    // A line budgeted far below what it actually costs would otherwise show a
    // whole year in red, saying nothing about any individual month.
    const bars = historyBars(MONTHS, { budgetMinor: 1_00 });
    expect(bars.every((b) => b.overBudget)).toBe(true);
    expect(bars.map((b) => b.vsAverage)).toEqual(['about', 'below', 'above']);
  });

  it('calls every month ordinary when nothing was spent', () => {
    const zeroes = [
      { period: '2026-08', totalMinor: 0 },
      { period: '2026-09', totalMinor: 0 },
    ];
    expect(historyBars(zeroes).every((b) => b.vsAverage === 'about')).toBe(true);
  });
});
