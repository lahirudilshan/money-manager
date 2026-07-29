import { describe, expect, it } from 'vitest';
import {
  matchMerchant,
  merchantKey,
  planRuleUpsert,
  type MerchantRule,
} from '../merchantRules';
import { SEED_MERCHANT_PATTERNS } from '../smsCategoryHints';

function rule(partial: Partial<MerchantRule> & { pattern: string }): MerchantRule {
  return {
    id: partial.pattern,
    subcategoryId: 'sub_1',
    hint: null,
    source: 'learned',
    hitCount: 1,
    updatedAt: 0,
    ...partial,
  };
}

describe('merchantKey', () => {
  it('normalises case and punctuation', () => {
    expect(merchantKey('KEELLS SUPER - SINHARAMUL')).toBe('keells super sinharamul');
  });

  it('glues the letter-spaced form banks emit', () => {
    expect(merchantKey('F L I TRADING')).toBe('fli trading');
  });

  it('maps both spellings of a merchant onto one key', () => {
    expect(merchantKey('F L I TRADING')).toBe(merchantKey('FLI Trading'));
  });

  it('drops trailing branch/location noise', () => {
    expect(merchantKey('CARGILLS FOOD CITY, LK')).toBe('cargills food city');
  });

  it('returns empty for text with nothing usable', () => {
    expect(merchantKey('   ---  ')).toBe('');
  });
});

describe('matchMerchant', () => {
  it('reports an exact merchant match with full confidence', () => {
    const match = matchMerchant('F L I Trading', [rule({ pattern: 'fli trading' })]);
    expect(match.confidence).toBe('exact');
    expect(match.subcategoryId).toBe('sub_1');
  });

  it('reports containment as a likely match', () => {
    const match = matchMerchant('KEELLS SUPER SINHARAMUL', [rule({ pattern: 'keells' })]);
    expect(match.confidence).toBe('likely');
  });

  it('prefers the more specific pattern on a partial match', () => {
    const match = matchMerchant('keells super sinharamul', [
      rule({ pattern: 'keells', subcategoryId: 'broad' }),
      rule({ pattern: 'keells super', subcategoryId: 'specific' }),
    ]);
    expect(match.subcategoryId).toBe('specific');
  });

  it('prefers the most-confirmed rule among exact duplicates', () => {
    const match = matchMerchant('spar', [
      rule({ pattern: 'spar', id: 'a', subcategoryId: 'rare', hitCount: 1 }),
      rule({ pattern: 'spar', id: 'b', subcategoryId: 'common', hitCount: 9 }),
    ]);
    expect(match.subcategoryId).toBe('common');
  });

  it('returns unknown when nothing matches', () => {
    expect(matchMerchant('some new shop', [rule({ pattern: 'keells' })]).confidence).toBe(
      'unknown',
    );
  });

  it('returns unknown for an empty merchant', () => {
    expect(matchMerchant('', [rule({ pattern: 'keells' })]).confidence).toBe('unknown');
  });

  it('ignores very short patterns when matching by containment', () => {
    expect(matchMerchant('a big shop', [rule({ pattern: 'ab' })]).confidence).toBe('unknown');
  });
});

describe('planRuleUpsert', () => {
  it('inserts a rule for a merchant never seen before', () => {
    const plan = planRuleUpsert('F L I TRADING', 'sub_food', 'groceries', []);
    expect(plan).toEqual({
      kind: 'insert',
      pattern: 'fli trading',
      subcategoryId: 'sub_food',
      hint: 'groceries',
    });
  });

  it('strengthens the existing rule when the merchant is already known', () => {
    const existing = rule({ pattern: 'fli trading', id: 'r1' });
    expect(planRuleUpsert('F L I Trading', 'sub_food', null, [existing])).toEqual({
      kind: 'strengthen',
      id: 'r1',
      subcategoryId: 'sub_food',
    });
  });

  it('re-points an existing rule when the user corrects the category', () => {
    const existing = rule({ pattern: 'fli trading', id: 'r1', subcategoryId: 'wrong' });
    const plan = planRuleUpsert('FLI TRADING', 'corrected', null, [existing]);
    expect(plan).toEqual({ kind: 'strengthen', id: 'r1', subcategoryId: 'corrected' });
  });

  it('teaches nothing from an empty merchant', () => {
    expect(planRuleUpsert('', 'sub_1', null, [])).toBeNull();
  });

  it('teaches nothing without a target line', () => {
    expect(planRuleUpsert('keells', '', null, [])).toBeNull();
  });
});

/**
 * Seed rules ship with a hint but no line (the app cannot know the user's
 * board). They must inform the category guess without ever silently selecting
 * a bill, and must lose to anything the user has actually taught.
 */
describe('seeded merchant patterns', () => {
  const seeded: MerchantRule[] = SEED_MERCHANT_PATTERNS.flatMap(([hint, patterns]) =>
    patterns.map((pattern) => ({
      id: pattern,
      pattern: merchantKey(pattern),
      subcategoryId: null,
      hint,
      source: 'seed' as const,
      hitCount: 0,
      updatedAt: 0,
    })),
  );

  it('recognises a well-known chain out of the box', () => {
    const match = matchMerchant('KEELLS SUPER SINHARAMUL', seeded);
    expect(match.hint).toBe('groceries');
  });

  it('never selects a line from a seed rule alone', () => {
    expect(matchMerchant('KEELLS SUPER SINHARAMUL', seeded).subcategoryId).toBeNull();
  });

  it('lets a learned rule win over the seed for the same merchant', () => {
    const learned = rule({
      pattern: merchantKey('keells super sinharamul'),
      id: 'learned',
      subcategoryId: 'sub_food',
      hitCount: 3,
      updatedAt: 99,
    });
    const match = matchMerchant('KEELLS SUPER SINHARAMUL', [...seeded, learned]);
    expect(match.subcategoryId).toBe('sub_food');
    expect(match.confidence).toBe('exact');
  });

  it('produces a usable key for every shipped pattern', () => {
    for (const seed of seeded) expect(seed.pattern.length).toBeGreaterThanOrEqual(3);
  });
});
