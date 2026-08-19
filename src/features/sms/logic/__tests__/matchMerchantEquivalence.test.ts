import { describe, expect, it } from 'vitest';
import { matchMerchant, type MerchantRule } from '~/features/sms/logic/merchantRules';

const rule = (p: string, sub: string, hit = 0, upd = 0): MerchantRule => ({
  id: `r_${p}_${sub}`, pattern: p, subcategoryId: sub, hint: null,
  hitCount: hit, updatedAt: upd,
} as MerchantRule);

/** Reference implementation: the filter+sort this replaced. */
function reference(merchantKeyed: string, rules: MerchantRule[]) {
  const byStrength = (a: MerchantRule, b: MerchantRule) =>
    b.hitCount - a.hitCount || b.updatedAt - a.updatedAt;
  const exact = rules.filter((r) => r.pattern === merchantKeyed).sort(byStrength)[0];
  if (exact) return exact.subcategoryId;
  const partial = rules
    .filter((r) => r.pattern.length >= 3 && (merchantKeyed.includes(r.pattern) || r.pattern.includes(merchantKeyed)))
    .sort((a, b) => b.pattern.length - a.pattern.length || byStrength(a, b))[0];
  return partial?.subcategoryId;
}

describe('matchMerchant single-pass equivalence', () => {
  it('agrees with filter+sort across randomised rule sets', () => {
    let checked = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const rules: MerchantRule[] = [];
      const n = seed % 7;
      for (let i = 0; i <= n; i += 1) {
        const pat = ['keells', 'keellssuper', 'food', 'foodcity', 'ab'][(seed + i) % 5];
        rules.push(rule(pat, `sub${(seed + i) % 3}`, (seed * (i + 1)) % 5, (seed + i) % 4));
      }
      const got = matchMerchant('keells', rules);
      const want = reference('keells', rules);
      expect(got.subcategoryId ?? undefined).toBe(want);
      checked += 1;
    }
    expect(checked).toBe(400);
  });
});
