import { describe, expect, it } from 'vitest';
import {
  refillComparisons,
  refillRunway,
  type NextDue,
  type Refill,
} from '~/features/refills/logic/refills';

/** Spans of 100, then 130 (clearly longer), then 100 (clearly shorter). */
const refills: Refill[] = [
  { id: 'a', filledOn: new Date('2026-01-01T00:00:00Z'), priceMinor: 100000 },
  { id: 'b', filledOn: new Date('2026-04-11T00:00:00Z'), priceMinor: 110000 },
  { id: 'c', filledOn: new Date('2026-08-19T00:00:00Z'), priceMinor: 105000 },
  { id: 'd', filledOn: new Date('2026-11-27T00:00:00Z'), priceMinor: 105000 },
];

describe('refillComparisons', () => {
  it('has nothing to compare for the oldest span', () => {
    const c = refillComparisons(refills).get('a')!;
    expect(c.daysDelta).toBeNull();
    expect(c.verdict).toBeNull();
  });

  it('marks a meaningfully longer run good', () => {
    const c = refillComparisons(refills).get('b')!;
    expect(c.daysDelta).toBeGreaterThan(0);
    expect(c.verdict).toBe('good');
  });

  it('marks a meaningfully shorter run bad', () => {
    const c = refillComparisons(refills).get('c')!;
    expect(c.daysDelta).toBeLessThan(0);
    expect(c.verdict).toBe('bad');
  });

  /* Colour that fires on noise carries no information. */
  it('treats a small change as the same', () => {
    const steady: Refill[] = [
      { id: 'x', filledOn: new Date('2026-01-01T00:00:00Z') },
      { id: 'y', filledOn: new Date('2026-04-11T00:00:00Z') }, // 100 days
      { id: 'z', filledOn: new Date('2026-07-25T00:00:00Z') }, // 105 days, +5%
    ];
    expect(refillComparisons(steady).get('y')!.verdict).toBe('same');
  });

  it('reports the price change against the previous priced entry', () => {
    const c = refillComparisons(refills).get('b')!;
    expect(c.priceDelta).toBe(10000);
  });

  /* An unpriced entry must not read as "the price fell to zero". */
  it('leaves the price delta null when a figure is missing', () => {
    const mixed: Refill[] = [
      { id: 'p', filledOn: new Date('2026-01-01T00:00:00Z'), priceMinor: 1000 },
      { id: 'q', filledOn: new Date('2026-04-11T00:00:00Z'), priceMinor: null },
      { id: 'r', filledOn: new Date('2026-07-25T00:00:00Z'), priceMinor: 1200 },
    ];
    expect(refillComparisons(mixed).get('q')!.priceDelta).toBeNull();
  });

  /*
   * The row colour asks a different question from the delta chip: "was this a
   * good one?" is measured against the item's own norm, not against whichever
   * entry happened to come before it.
   */
  it('grades each span against the average, not the previous one', () => {
    /*
     * Spans of 100, 130, 100 -> mean 110, band ±11. The two 100-day runs sit 10
     * below the mean, INSIDE the band, so they are `about` — even though each
     * is 30 days shorter than the 130 beside it. That is the distinction this
     * field exists to draw: `verdict` compares neighbours, `vsAverage` compares
     * with the norm, and they legitimately disagree here.
     */
    const c = refillComparisons(refills);
    expect(c.get('a')!.vsAverage).toBe('about');
    expect(c.get('b')!.vsAverage).toBe('above');
    expect(c.get('c')!.vsAverage).toBe('about');
    // The same rows read as a real change against their immediate neighbour.
    expect(c.get('b')!.verdict).toBe('good');
    expect(c.get('c')!.verdict).toBe('bad');
  });

  it('calls a span near the mean about average', () => {
    const steady: Refill[] = [
      { id: 'x', filledOn: new Date('2026-01-01T00:00:00Z') },
      { id: 'y', filledOn: new Date('2026-04-11T00:00:00Z') }, // 100
      { id: 'z', filledOn: new Date('2026-07-25T00:00:00Z') }, // 105
    ];
    const c = refillComparisons(steady);
    expect(c.get('x')!.vsAverage).toBe('about');
    expect(c.get('y')!.vsAverage).toBe('about');
  });

  /* Two mediocre runs read `same` against each other but both below the norm. */
  it('a lone span is trivially about average', () => {
    const one: Refill[] = [
      { id: 'p', filledOn: new Date('2026-01-01T00:00:00Z') },
      { id: 'q', filledOn: new Date('2026-04-11T00:00:00Z') },
    ];
    expect(refillComparisons(one).get('p')!.vsAverage).toBe('about');
  });

  it('reports how far each row sits from the average duration', () => {
    // Spans 100, 130, 100 -> mean 110.
    const c = refillComparisons(refills);
    expect(c.get('a')!.daysVsAverage).toBe(-10);
    expect(c.get('b')!.daysVsAverage).toBe(20);
  });

  it('reports how far each row sits from the average price', () => {
    // Prices 100000, 110000, 105000, 105000 -> mean 105000.
    const c = refillComparisons(refills);
    expect(c.get('a')!.priceVsAverage).toBe(-5000);
    expect(c.get('b')!.priceVsAverage).toBe(5000);
  });

  /* No figure on the row means no comparison — never a zero. */
  it('leaves the price gap null when the row has no price', () => {
    const mixed: Refill[] = [
      { id: 'p', filledOn: new Date('2026-01-01T00:00:00Z'), priceMinor: null },
      { id: 'q', filledOn: new Date('2026-04-11T00:00:00Z'), priceMinor: 1000 },
      { id: 'r', filledOn: new Date('2026-07-25T00:00:00Z'), priceMinor: 1200 },
    ];
    expect(refillComparisons(mixed).get('p')!.priceVsAverage).toBeNull();
  });

  it('never keys the entry still in use', () => {
    // 'd' opened no completed span — nothing has replaced it yet.
    expect(refillComparisons(refills).has('d')).toBe(false);
  });
});

const due = (inDays: number): NextDue => ({
  on: new Date(),
  inDays,
  basis: 'measured',
  provisional: false,
});

describe('refillRunway', () => {
  it('is null without a projection', () => {
    expect(refillRunway(null)).toBeNull();
  });

  it('reads the four bands', () => {
    expect(refillRunway(due(60))).toBe('plenty');
    expect(refillRunway(due(21))).toBe('getting-close');
    expect(refillRunway(due(7))).toBe('nearly-out');
    expect(refillRunway(due(-1))).toBe('out');
  });

  it('puts the boundary days in the safer band', () => {
    expect(refillRunway(due(22))).toBe('plenty');
    expect(refillRunway(due(8))).toBe('getting-close');
    expect(refillRunway(due(0))).toBe('nearly-out');
  });
});
