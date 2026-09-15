import { describe, expect, it } from 'vitest';
import { inferCategoryHint } from '../smsCategoryHints';

/**
 * Two more gaps the user's own history exposed.
 *
 * `transport` was a declared tag with NO patterns anywhere — so a railway
 * ticket matched nothing and the card said "Needs a category". And the
 * subscription seed list knew Netflix and Spotify but not DistroKid, so a
 * recurring music-distribution charge was equally blank.
 */

describe('transport', () => {
  it('recognises a railway ticket', () => {
    expect(inferCategoryHint('RAILWAY +141570776')).toBe('transport');
  });

  it('recognises the usual ways of getting about', () => {
    for (const name of ['PickMe', 'Uber trip', 'railway booking', 'bus ticket']) {
      expect(inferCategoryHint(name), name).toBe('transport');
    }
  });
});

describe('subscriptions', () => {
  it('recognises DistroKid', () => {
    expect(inferCategoryHint('DISTROKID MUSICIAN+ +141536661')).toBe('subscription');
  });
});

describe('what must not change', () => {
  it('leaves fuel alone', () => {
    // "filling station" is transport-adjacent but has its own tag already.
    expect(inferCategoryHint('CEYPETCO FILLING STATION')).toBe('fuel');
  });
});
