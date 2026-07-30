import { describe, expect, it } from 'vitest';
import { canUse, inheritedPerks, planById, planFor, PLANS } from '../plans';

/**
 * The gate every screen asks before showing a premium feature, so a wrong
 * answer here either hides something a paying user bought or gives it away.
 */
describe('plan entitlements', () => {
  it('locks Smart Detect on Free', () => {
    expect(canUse('free', 'smartDetect')).toBe(false);
  });

  it('unlocks Smart Detect on Premium', () => {
    expect(canUse('premium', 'smartDetect')).toBe(true);
  });

  it('names the tier a feature needs, for the upgrade prompt', () => {
    expect(planFor('smartDetect')?.id).toBe('premium');
  });

  it('falls back to Free for an unrecognised stored value', () => {
    // The plan is read from settings, so a hand-edited or future value must not
    // resolve to something that unlocks features.
    // @ts-expect-error deliberately invalid
    expect(planById('enterprise').id).toBe('free');
    // @ts-expect-error deliberately invalid
    expect(canUse('enterprise', 'smartDetect')).toBe(false);
  });

  it('lists Free before Premium, so the screen reads cheapest first', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['free', 'premium']);
  });

  it('gives every plan a name and at least one perk', () => {
    for (const plan of PLANS) {
      expect(plan.name.length).toBeGreaterThan(0);
      expect(plan.perks.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Premium is sold as "everything in Free, plus these". Its own `perks` list
 * therefore holds ONLY its additions — the screen renders the inherited ones
 * separately, so a perk duplicated across both tiers would appear twice.
 */
describe('inherited perks', () => {
  it('gives Free nothing to inherit', () => {
    expect(inheritedPerks('free')).toEqual([]);
  });

  it('hands Premium every Free perk', () => {
    const free = PLANS[0].perks.map((p) => p.label);
    expect(inheritedPerks('premium').map((p) => p.label)).toEqual(free);
  });

  it('keeps a paid tier from repeating what it already inherits', () => {
    const own = new Set(planById('premium').perks.map((p) => p.label));
    for (const perk of inheritedPerks('premium')) {
      expect(own.has(perk.label)).toBe(false);
    }
  });

  it('prices the paid tier and leaves the free one blank', () => {
    expect(planById('free').price).toBe('');
    expect(planById('premium').price.length).toBeGreaterThan(0);
  });
});
