import { describe, expect, it } from 'vitest';
import {
  describeDays,
  durationBars,
  nextDue,
  priceHistory,
  refillSpans,
  refillStats,
  refillStatus,
  type Refill,
} from '~/features/refills/logic/refills';

/** Gas cylinder bought three times, roughly every 104 days. */
const cylinders: Refill[] = [
  { id: 'a', filledOn: new Date('2026-02-18T10:00:00Z'), priceMinor: 395000 },
  { id: 'b', filledOn: new Date('2026-06-02T10:00:00Z'), priceMinor: 395000 },
  { id: 'c', filledOn: new Date('2026-09-14T10:00:00Z'), priceMinor: 420000 },
];

describe('refillSpans', () => {
  it('measures the gap between consecutive refills', () => {
    const spans = refillSpans(cylinders);
    expect(spans).toHaveLength(2);
    expect(spans[0].days).toBe(104);
    expect(spans[1].days).toBe(104);
  });

  it('reports the span against the refill that OPENED it', () => {
    const [first] = refillSpans(cylinders);
    // 'a' was the cylinder consumed over those 104 days, so its price is the cost.
    expect(first.id).toBe('a');
    expect(first.costMinor).toBe(395000);
  });

  /*
   * The most important guard: the cylinder bought last is still in use, so
   * counting it would add a short partial period and drag every average down.
   */
  it('never produces a span for the newest refill', () => {
    const spans = refillSpans(cylinders);
    expect(spans.map((s) => s.id)).not.toContain('c');
  });

  it('has nothing to say about a single refill', () => {
    expect(refillSpans([cylinders[0]])).toEqual([]);
  });

  it('ignores order of entry', () => {
    const shuffled = [cylinders[2], cylinders[0], cylinders[1]];
    expect(refillSpans(shuffled).map((s) => s.days)).toEqual([104, 104]);
  });

  /* Two entries on one date is a double entry, not a zero-day lifetime. */
  it('skips same-day duplicates rather than reporting a zero-day span', () => {
    const dupes: Refill[] = [
      { id: 'a', filledOn: new Date('2026-02-18T08:00:00Z'), priceMinor: 100 },
      { id: 'a2', filledOn: new Date('2026-02-18T19:00:00Z'), priceMinor: 100 },
      { id: 'b', filledOn: new Date('2026-03-20T10:00:00Z'), priceMinor: 100 },
    ];
    const spans = refillSpans(dupes);
    expect(spans.every((s) => s.days > 0)).toBe(true);
  });

  it('derives cost per day from the opening price', () => {
    const [first] = refillSpans(cylinders);
    expect(first.costPerDayMinor).toBeCloseTo(395000 / 104, 5);
  });

  it('leaves cost per day null when the refill had no price', () => {
    const unpriced: Refill[] = [
      { id: 'a', filledOn: new Date('2026-01-01T00:00:00Z'), priceMinor: null },
      { id: 'b', filledOn: new Date('2026-02-01T00:00:00Z'), priceMinor: 500 },
    ];
    expect(refillSpans(unpriced)[0].costPerDayMinor).toBeNull();
  });
});

describe('refillStats', () => {
  const now = new Date('2026-09-28T10:00:00Z');

  it('averages only completed spans', () => {
    expect(refillStats(cylinders, now).averageDays).toBe(104);
  });

  it('counts days on the current unit from the last refill', () => {
    expect(refillStats(cylinders, now).daysOnCurrent).toBe(14);
  });

  it('reports the range', () => {
    const varied: Refill[] = [
      { id: 'a', filledOn: new Date('2026-01-01T00:00:00Z') },
      { id: 'b', filledOn: new Date('2026-02-10T00:00:00Z') },
      { id: 'c', filledOn: new Date('2026-06-01T00:00:00Z') },
    ];
    const stats = refillStats(varied, now);
    expect(stats.shortestDays).toBe(40);
    expect(stats.longestDays).toBe(111);
  });

  /* A blank price on the newest swap should not erase the known price. */
  it('falls back to the newest refill that actually has a price', () => {
    const withBlank: Refill[] = [
      ...cylinders,
      { id: 'd', filledOn: new Date('2026-09-20T10:00:00Z'), priceMinor: null },
    ];
    expect(refillStats(withBlank, now).lastPriceMinor).toBe(420000);
  });

  it('averages the price across priced refills only', () => {
    // 395000, 395000, 420000 -> mean 403333.33 -> 403333
    expect(refillStats(cylinders, now).averagePriceMinor).toBe(403333);
  });

  it('has no average price when nothing is priced', () => {
    const none = [{ id: 'a', filledOn: new Date('2026-01-01T00:00:00Z') }];
    expect(refillStats(none, now).averagePriceMinor).toBeNull();
  });

  it('totals every priced refill', () => {
    expect(refillStats(cylinders, now).totalSpentMinor).toBe(1210000);
  });

  it('says nothing rather than zero when there is no history', () => {
    const stats = refillStats([], now);
    expect(stats.averageDays).toBeNull();
    expect(stats.daysOnCurrent).toBeNull();
    expect(stats.spanCount).toBe(0);
  });
});

describe('nextDue', () => {
  const now = new Date('2026-09-28T10:00:00Z');

  it('projects from measured history', () => {
    const due = nextDue(cylinders, { expectedDays: null }, now);
    expect(due?.basis).toBe('measured');
    // 14 Sep + 104 days = 27 Dec 2026
    expect(due?.on.toISOString().slice(0, 10)).toBe('2026-12-27');
  });

  /* The whole point of measuring: people guess badly about their own usage. */
  it('prefers measured history over the user expectation', () => {
    const due = nextDue(cylinders, { expectedDays: 30 }, now);
    expect(due?.basis).toBe('measured');
    expect(due?.inDays).toBeGreaterThan(60);
  });

  it('falls back to the expectation until there is history', () => {
    const due = nextDue([cylinders[2]], { expectedDays: 90 }, now);
    expect(due?.basis).toBe('expected');
    expect(due?.provisional).toBe(false);
  });

  it('flags a projection resting on a single span as provisional', () => {
    const due = nextDue(cylinders.slice(0, 2), { expectedDays: null }, now);
    expect(due?.provisional).toBe(true);
  });

  it('is null when there is neither history nor an expectation', () => {
    expect(nextDue([cylinders[2]], { expectedDays: null }, now)).toBeNull();
  });

  it('is null with no refills at all', () => {
    expect(nextDue([], { expectedDays: 90 }, now)).toBeNull();
  });

  it('goes negative once overdue', () => {
    const due = nextDue(cylinders, { expectedDays: null }, new Date('2027-01-10T10:00:00Z'));
    expect(due?.inDays).toBeLessThan(0);
    expect(refillStatus(due)).toBe('overdue');
  });
});

describe('refillStatus', () => {
  const now = new Date('2026-09-28T10:00:00Z');

  it('warns inside the last week', () => {
    const due = nextDue(cylinders, { expectedDays: null }, new Date('2026-12-23T10:00:00Z'));
    expect(refillStatus(due)).toBe('due-soon');
  });

  it('is fresh with plenty of time left', () => {
    expect(refillStatus(nextDue(cylinders, { expectedDays: null }, now))).toBe('fresh');
  });

  it('is unknown without a projection', () => {
    expect(refillStatus(null)).toBe('unknown');
  });
});

describe('priceHistory', () => {
  it('tracks the change between priced refills', () => {
    const points = priceHistory(cylinders);
    expect(points).toHaveLength(3);
    expect(points[0].changeMinor).toBeNull();
    expect(points[2].changeMinor).toBe(25000);
    expect(points[2].changePct).toBe(6);
  });

  /* A zero would draw a cliff to the axis and read as "it became free". */
  it('drops unpriced refills rather than plotting them as zero', () => {
    const mixed: Refill[] = [
      { id: 'a', filledOn: new Date('2026-01-01T00:00:00Z'), priceMinor: 1000 },
      { id: 'b', filledOn: new Date('2026-02-01T00:00:00Z'), priceMinor: null },
      { id: 'c', filledOn: new Date('2026-03-01T00:00:00Z'), priceMinor: 1200 },
    ];
    const points = priceHistory(mixed);
    expect(points.map((p) => p.id)).toEqual(['a', 'c']);
    expect(points[1].changeMinor).toBe(200);
  });

  it('is empty when nothing has a price', () => {
    expect(priceHistory([{ id: 'a', filledOn: new Date() }])).toEqual([]);
  });
});

describe('durationBars', () => {
  it('scales bars against the longest span', () => {
    const varied: Refill[] = [
      { id: 'a', filledOn: new Date('2026-01-01T00:00:00Z') },
      { id: 'b', filledOn: new Date('2026-02-10T00:00:00Z') },
      { id: 'c', filledOn: new Date('2026-06-01T00:00:00Z') },
    ];
    const bars = durationBars(refillSpans(varied));
    expect(bars).toHaveLength(2);
    expect(bars[1].fraction).toBe(1);
    expect(bars[0].fraction).toBeCloseTo(40 / 111, 5);
  });

  it('refuses to chart a single span', () => {
    expect(durationBars(refillSpans(cylinders.slice(0, 2)))).toEqual([]);
  });

  it('marks a run against the average', () => {
    const varied: Refill[] = [
      { id: 'a', filledOn: new Date('2026-01-01T00:00:00Z') },
      { id: 'b', filledOn: new Date('2026-02-10T00:00:00Z') },
      { id: 'c', filledOn: new Date('2026-06-01T00:00:00Z') },
    ];
    const bars = durationBars(refillSpans(varied));
    expect(bars[0].vsAverage).toBe('below');
    expect(bars[1].vsAverage).toBe('above');
  });
});

describe('describeDays', () => {
  it('speaks in days under a month', () => {
    expect(describeDays(1)).toBe('1 day');
    expect(describeDays(12)).toBe('12 days');
  });

  it('speaks in months and days beyond that', () => {
    expect(describeDays(104)).toBe('3 months 14 days');
    expect(describeDays(60)).toBe('2 months');
  });
});
