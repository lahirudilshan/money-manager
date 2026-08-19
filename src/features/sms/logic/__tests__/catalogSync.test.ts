import { describe, expect, it } from 'vitest';
import {
  bucketForMinor,
  observationsFrom,
  planCatalogMerge,
  MIN_MARGIN,
  type SharedRule,
} from '../catalogSync';
import type { MerchantRule } from '../merchantRules';

function local(overrides: Partial<MerchantRule> = {}): MerchantRule {
  return {
    id: 'rule-1',
    pattern: 'keells',
    subcategoryId: 'sub-groceries',
    hint: 'groceries',
    source: 'learned',
    hitCount: 3,
    updatedAt: 1,
    ...overrides,
  };
}

function shared(overrides: Partial<SharedRule> = {}): SharedRule {
  return {
    merchant: 'keells',
    hint: 'groceries',
    votes: 40,
    source: 'learned',
    margin: 40,
    ...overrides,
  };
}

describe('planCatalogMerge', () => {
  it('mirrors a merchant the device has never seen', () => {
    // The whole reason the mirror exists: this row is what makes an unknown
    // merchant detectable OFFLINE, with no network at the moment the SMS lands.
    const plan = planCatalogMerge([shared({ merchant: 'cargills', hint: 'groceries' })], []);

    expect(plan.insert).toEqual([{ pattern: 'cargills', hint: 'groceries' }]);
    expect(plan.updateHint).toEqual([]);
  });

  it('never touches a rule the user taught, even against overwhelming votes', () => {
    // The core promise: a personal correction outranks the crowd. If this
    // breaks, syncing silently undoes the user's own work.
    const plan = planCatalogMerge(
      [shared({ merchant: 'fli trading', hint: 'fuel', votes: 9999, margin: 9999 })],
      [local({ pattern: 'fli trading', hint: 'groceries', source: 'learned' })],
    );

    expect(plan.insert).toEqual([]);
    expect(plan.updateHint).toEqual([]);
  });

  it('corrects a shipped seed rule whose hint the catalog disagrees with', () => {
    const plan = planCatalogMerge(
      [shared({ merchant: 'ioc', hint: 'fuel' })],
      [local({ id: 'r-ioc', pattern: 'ioc', hint: 'telecom', source: 'seed' })],
    );

    expect(plan.updateHint).toEqual([{ id: 'r-ioc', hint: 'fuel' }]);
  });

  it('leaves a seed rule alone when the hint already agrees', () => {
    // Rewriting an identical hint would churn updatedAt on every single sync.
    const plan = planCatalogMerge(
      [shared({ merchant: 'ioc', hint: 'fuel' })],
      [local({ id: 'r-ioc', pattern: 'ioc', hint: 'fuel', source: 'seed' })],
    );

    expect(plan.updateHint).toEqual([]);
  });

  it('ignores a contested merchant', () => {
    // 40 vs 39 is a coin flip; mirroring the bare winner would present a
    // disagreement to every device as though it were settled.
    const plan = planCatalogMerge([shared({ merchant: 'unclear', margin: MIN_MARGIN - 1 })], []);

    expect(plan.insert).toEqual([]);
  });

  it('protects a merchant when only one of its several rules is learned', () => {
    const plan = planCatalogMerge(
      [shared({ merchant: 'keells', hint: 'fuel' })],
      [
        local({ id: 'a', pattern: 'keells', hint: 'groceries', source: 'seed' }),
        local({ id: 'b', pattern: 'keells', hint: 'groceries', source: 'learned' }),
      ],
    );

    expect(plan.updateHint).toEqual([]);
  });

  it('applies only the first of a duplicated merchant in one page', () => {
    const plan = planCatalogMerge(
      [shared({ merchant: 'spar', hint: 'groceries' }), shared({ merchant: 'spar', hint: 'fuel' })],
      [],
    );

    expect(plan.insert).toEqual([{ pattern: 'spar', hint: 'groceries' }]);
  });

  it('skips a row with an empty merchant', () => {
    expect(planCatalogMerge([shared({ merchant: '' })], []).insert).toEqual([]);
  });
});

describe('bucketForMinor', () => {
  it('bands an amount without revealing it', () => {
    // Minor units in, band out. The boundaries must match AMOUNT_BUCKETS in
    // server/lib/contract.ts or the server rejects the value outright.
    expect(bucketForMinor(49_900)).toBe('under_500');
    expect(bucketForMinor(50_000)).toBe('500_2k');
    expect(bucketForMinor(432_000)).toBe('2k_10k');
    expect(bucketForMinor(4_500_000)).toBe('10k_50k');
    expect(bucketForMinor(9_000_000)).toBe('50k_200k');
    expect(bucketForMinor(50_000_000)).toBe('over_200k');
  });

  it('treats a negative amount as its magnitude', () => {
    expect(bucketForMinor(-432_000)).toBe('2k_10k');
  });
});

describe('observationsFrom', () => {
  it('uploads only the five contract fields — never amounts, ids or SMS text', () => {
    // Pins the privacy contract: whatever else a MerchantRule carries, exactly
    // these fields leave the device, and the amount appears only as a band.
    const observations = observationsFrom([
      {
        rule: local({ pattern: 'fli trading', hint: 'groceries', subcategoryId: 'sub-secret' }),
        direction: 'debit',
        amountMinor: 432_000,
      },
    ]);

    expect(observations).toEqual([
      {
        merchant: 'fli trading',
        hint: 'groceries',
        sender: null,
        direction: 'debit',
        amountBucket: '2k_10k',
      },
    ]);
    expect(Object.keys(observations[0]).sort()).toEqual([
      'amountBucket',
      'direction',
      'hint',
      'merchant',
      'sender',
    ]);
  });

  it('never leaks the exact amount, only its band', () => {
    const [observation] = observationsFrom([
      { rule: local(), direction: 'debit', amountMinor: 432_017 },
    ]);

    expect(JSON.stringify(observation)).not.toContain('432017');
    expect(observation.amountBucket).toBe('2k_10k');
  });

  it('does not echo shipped seed rules back as votes', () => {
    // A seed rule votes for what the app already believed, inflating consensus
    // with no new information.
    expect(observationsFrom([{ rule: local({ source: 'seed' }) }])).toEqual([]);
  });

  it('skips a rule with no hint, which has nothing shareable', () => {
    expect(observationsFrom([{ rule: local({ hint: null }) }])).toEqual([]);
  });

  it('votes once per merchant, backing the most-confirmed hint', () => {
    const observations = observationsFrom([
      { rule: local({ id: 'a', pattern: 'spar', hint: 'fuel', hitCount: 1 }) },
      { rule: local({ id: 'b', pattern: 'spar', hint: 'groceries', hitCount: 9 }) },
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0].hint).toBe('groceries');
  });
});
