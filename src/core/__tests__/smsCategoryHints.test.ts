import { describe, expect, it } from 'vitest';
import samplesFile from '../../data/sms-samples.json';
import { parseSms } from '../smsParser';
import { billMatchesHint, inferCategoryHint, inferCategoryHints } from '../smsCategoryHints';

interface Sample {
  id: string;
  raw: string;
  expect: unknown;
}
const byId = (id: string) => (samplesFile.samples as Sample[]).find((s) => s.id === id)!.raw;

describe('inferCategoryHint over real merchant strings', () => {
  const cases: [string, string][] = [
    ['ndb-pos-water', 'water'],
    ['ndb-pos-electricity', 'electricity'],
    ['ndb-pos-dialog', 'telecom'],
    ['ndb-pos-grocery', 'groceries'],
    ['ndb-pos-subscription', 'subscription'],
    ['hnb-pos-purchase', 'groceries'], // KEELLS SUPER
    ['hnb-loan-payment', 'loan'],
    ['ndb-cefts-outward', 'transfer'],
    ['hnb-atm-withdrawal', 'atm'],
  ];

  for (const [sampleId, expected] of cases) {
    it(`${sampleId} → ${expected}`, () => {
      const parsed = parseSms(byId(sampleId))!;
      expect(inferCategoryHint(`${parsed.merchant} ${parsed.raw}`)).toBe(expected);
    });
  }

  it('returns null when nothing recognisable matches', () => {
    expect(inferCategoryHint('LKR 500.00 debited at XYZQ RANDOM VENDOR')).toBeNull();
  });

  it('prefers a utility tag over the generic transfer bucket', () => {
    // A message that mentions both water and a transfer resolves to water.
    expect(inferCategoryHint('CEFTS transfer for National Water Supply')).toBe('water');
  });
});

describe('inferCategoryHints (multi)', () => {
  it('lists every matching tag in priority order', () => {
    const hints = inferCategoryHints('KEELLS SUPER fuel filling station');
    expect(hints).toContain('groceries');
    expect(hints).toContain('fuel');
    // groceries entry precedes fuel in the map, so it ranks first.
    expect(hints.indexOf('groceries')).toBeLessThan(hints.indexOf('fuel'));
  });
});

describe('billMatchesHint', () => {
  it('matches a bill by its own name/category text', () => {
    expect(billMatchesHint('water', 'Water Utilities')).toBe(true);
    expect(billMatchesHint('electricity', 'CEB Utilities')).toBe(true);
    expect(billMatchesHint('water', 'Groceries Home')).toBe(false);
  });
});
