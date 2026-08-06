import { describe, expect, it } from 'vitest';
import {
  averageRate,
  driftPercent,
  effectiveRate,
  isFetchDue,
  latestRate,
  MAX_RATE_HISTORY,
  parseHistory,
  recordRate,
  serialiseHistory,
} from '../exchangeRate';

/**
 * The board needs ONE number to convert with, but the right number depends on
 * what it is converting. A dollar credit that already landed should use the
 * live rate; future dollar income should be planned at a conservative one, or
 * the user commits money that may never arrive.
 */

const NOW = new Date('2026-08-05T10:00:00Z');

describe('recordRate', () => {
  it('keeps newest first', () => {
    const history = recordRate(recordRate([], 300, new Date('2026-08-04T10:00:00Z')), 310, NOW);
    expect(history.map((point) => point.rate)).toEqual([310, 300]);
  });

  it('keeps only one reading per day', () => {
    /*
     * The app fetches on launch, so opening it five times in a morning would
     * otherwise stack five near-identical readings and drag the average toward
     * whatever today happens to be.
     */
    let history = recordRate([], 300, new Date('2026-08-05T08:00:00Z'));
    history = recordRate(history, 305, new Date('2026-08-05T12:00:00Z'));

    expect(history).toHaveLength(1);
    expect(history[0].rate).toBe(305);
  });

  it('caps the history', () => {
    let history: ReturnType<typeof recordRate> = [];
    const start = Date.parse('2026-01-01T10:00:00Z');

    for (let day = 0; day < MAX_RATE_HISTORY + 10; day += 1) {
      history = recordRate(history, 300 + day, new Date(start + day * 86_400_000));
    }

    expect(history).toHaveLength(MAX_RATE_HISTORY);
  });

  it('ignores a nonsense rate rather than storing it', () => {
    // A failed fetch that yields 0 or NaN must not poison the average.
    expect(recordRate([], 0, NOW)).toHaveLength(0);
    expect(recordRate([], Number.NaN, NOW)).toHaveLength(0);
    expect(recordRate([], -5, NOW)).toHaveLength(0);
  });
});

describe('effectiveRate', () => {
  const history = [
    { rate: 320, at: '2026-08-05T10:00:00Z' },
    { rate: 300, at: '2026-08-04T10:00:00Z' },
    { rate: 280, at: '2026-08-03T10:00:00Z' },
  ];

  it('live uses the newest reading', () => {
    expect(effectiveRate({ mode: 'live', history, manualRate: 250 })).toBe(320);
  });

  it('average smooths a single unusual day', () => {
    expect(effectiveRate({ mode: 'average', history, manualRate: 250 })).toBe(300);
  });

  it('safe uses the user\'s own figure and ignores the market', () => {
    // The whole point: planning against future dollar income at spot is how
    // someone over-commits the moment the rupee strengthens.
    expect(effectiveRate({ mode: 'safe', history, manualRate: 250 })).toBe(250);
  });

  it('always falls back to the manual rate rather than failing', () => {
    // A board that cannot convert is worse than one using a stale figure.
    expect(effectiveRate({ mode: 'live', history: [], manualRate: 250 })).toBe(250);
    expect(effectiveRate({ mode: 'average', history: [], manualRate: 250 })).toBe(250);
  });
});

describe('isFetchDue', () => {
  it('is due when never fetched', () => {
    expect(isFetchDue(null, NOW)).toBe(true);
  });

  it('is not due again the same day', () => {
    // Published rates move daily; refetching per launch spends data to redraw
    // the same number.
    expect(isFetchDue('2026-08-05T09:00:00Z', NOW)).toBe(false);
  });

  it('is due after a day', () => {
    expect(isFetchDue('2026-08-04T09:00:00Z', NOW)).toBe(true);
  });

  it('treats an unreadable timestamp as never fetched', () => {
    expect(isFetchDue('not a date', NOW)).toBe(true);
  });
});

describe('driftPercent', () => {
  it('reports how far the safe rate has fallen behind', () => {
    // A "safe" rate 20% below spot is not conservative, it is out of date —
    // and nothing else on the screen would say so.
    expect(driftPercent(300, 250)).toBe(20);
    expect(driftPercent(240, 250)).toBe(-4);
  });

  it('says nothing without a live reading', () => {
    expect(driftPercent(null, 250)).toBeNull();
  });
});

describe('history storage', () => {
  it('round-trips', () => {
    const history = recordRate([], 300, NOW);
    expect(parseHistory(serialiseHistory(history))).toEqual(history);
  });

  it('survives corrupt or foreign stored values', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"rate":300}')).toEqual([]);
    expect(parseHistory('[{"rate":"x","at":"y"},{"rate":300,"at":"2026-08-05"}]')).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('reads the latest and the average', () => {
    const history = [
      { rate: 320, at: '2026-08-05T10:00:00Z' },
      { rate: 280, at: '2026-08-04T10:00:00Z' },
    ];
    expect(latestRate(history)).toBe(320);
    expect(averageRate(history)).toBe(300);
    expect(latestRate([])).toBeNull();
    expect(averageRate([])).toBeNull();
  });
});
