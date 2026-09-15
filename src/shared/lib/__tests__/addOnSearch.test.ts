import { describe, expect, it } from 'vitest';
import { MINI_APPS } from '~/shared/lib/miniApps';

/** The exact predicate used by the add-ons sheet. */
const match = (q: string) =>
  MINI_APPS.filter(
    (a) =>
      a.name.toLowerCase().includes(q.toLowerCase()) ||
      a.description.toLowerCase().includes(q.toLowerCase()),
  ).map((a) => a.id);

describe('add-on search', () => {
  it('finds by name', () => {
    expect(match('usage')).toEqual(['trackers']);
    expect(match('buddy')).toEqual(['buddyloans']);
  });

  /* The whole reason description is searched: nobody types "usage". */
  it('finds by words only in the description', () => {
    expect(match('cylinder')).toEqual(['trackers']);
    expect(match('gas')).toEqual(['trackers']);
    expect(match('medicine')).toEqual(['health']);
    expect(match('mileage')).toEqual(['fuel']);
  });

  it('is case insensitive', () => {
    expect(match('CYLINDER')).toEqual(['trackers']);
  });

  it('returns nothing for a miss', () => {
    expect(match('zzzz')).toEqual([]);
  });
});
