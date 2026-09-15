import { describe, expect, it } from 'vitest';
import {
  trackerReminders,
  type Refill,
  type TrackedItem,
} from '~/features/refills/logic/refills';

const now = new Date('2026-09-15T10:00:00Z');

/** Two refills 30 days apart, so the measured average is 30 days. */
function history(lastFilled: string): Refill[] {
  const last = new Date(lastFilled);
  const first = new Date(last.getTime() - 30 * 86_400_000);
  return [
    { id: 'a', filledOn: first, priceMinor: 1000 },
    { id: 'b', filledOn: last, priceMinor: 1000 },
  ];
}

const item = (over: Partial<TrackedItem> & { id: string }): TrackedItem & { id: string } => ({
  name: 'Gas cylinder',
  ...over,
});

describe('trackerReminders', () => {
  it('reports an item inside the due-soon window', () => {
    // Filled 26 days ago, lasts ~30 → 4 days left.
    const items = [item({ id: 'g' })];
    const map = new Map([['g', history('2026-08-20T10:00:00Z')]]);
    const out = trackerReminders(items, map, now);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('due-soon');
    expect(out[0].daysUntil).toBeLessThanOrEqual(7);
  });

  it('reports an overdue item with a negative count', () => {
    const items = [item({ id: 'g' })];
    const map = new Map([['g', history('2026-08-01T10:00:00Z')]]);
    const out = trackerReminders(items, map, now);
    expect(out[0].status).toBe('overdue');
    expect(out[0].daysUntil).toBeLessThan(0);
  });

  /* An item with plenty of time is not something to act on. */
  it('drops a fresh item', () => {
    const items = [item({ id: 'g' })];
    const map = new Map([['g', history('2026-09-14T10:00:00Z')]]);
    expect(trackerReminders(items, map, now)).toEqual([]);
  });

  /*
   * The key rule: the dashboard must not repeat the user's own guess back at
   * them as a warning, or every new item fires on the day it is created.
   */
  it('ignores a projection based only on the user estimate', () => {
    const items = [item({ id: 'g', expectedDays: 3 })];
    const map = new Map([['g', [{ id: 'only', filledOn: new Date('2026-09-14T10:00:00Z') }]]]);
    expect(trackerReminders(items, map, now)).toEqual([]);
  });

  it('skips archived items', () => {
    const items = [item({ id: 'g', archived: true })];
    const map = new Map([['g', history('2026-08-01T10:00:00Z')]]);
    expect(trackerReminders(items, map, now)).toEqual([]);
  });

  it('sorts most urgent first', () => {
    const items = [item({ id: 'soon' }), item({ id: 'late' })];
    const map = new Map([
      ['soon', history('2026-08-20T10:00:00Z')],
      ['late', history('2026-08-01T10:00:00Z')],
    ]);
    expect(trackerReminders(items, map, now).map((r) => r.itemId)).toEqual(['late', 'soon']);
  });

  it('is empty with no items', () => {
    expect(trackerReminders([], new Map(), now)).toEqual([]);
  });
});
