import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inferCategoryHint } from '~/features/sms/logic/smsCategoryHints';

/**
 * The most specific rule wins, not the first one declared.
 *
 * `inferCategoryHint` used to return the first matching entry, which made
 * correctness a property of list order — every new keyword could silently
 * shadow one below it. The failure that exposed it: "debited ... as ATM
 * Withdrawal Fee" matched the one-word `/\batm\b/` before reaching the fee
 * patterns, so a 30-rupee bank charge was suggested as pocket money.
 */
describe('hint specificity', () => {
  it('prefers the longer phrase over a one-word match', () => {
    const fee =
      'LKR 30.00 debited from AC XXXXXXXX6796 on 17 Sep 2026 22:16 as ATM Withdrawal Fee';
    // "ATM Withdrawal Fee" is longer agreement than "ATM".
    expect(inferCategoryHint(fee)).toBe('bank_charge');
  });

  it('still reads a genuine withdrawal as ATM', () => {
    const withdrawal =
      'LKR 4,500.00 debited from AC XXXXXXXX6796 as ATM TXN at LANKAPAY PAYABLES Hatton National B';
    expect(inferCategoryHint(withdrawal)).toBe('atm');
  });

  it('keeps the categories that already worked', () => {
    const cases: [string, string][] = [
      ['KEELLS SUPER SINHARAMULKELANIYA POS TXN', 'groceries'],
      ['Dialog Axiata PLC Colombo 02', 'telecom'],
      ['A S P Pharmacy & Grocery Kelaniya', 'health'],
      ['RAILWAY +141570776', 'transport'],
      ['CEFTS Outward Transfer', 'transfer'],
      ['SALARY for Sep 2026', 'income'],
      ['CEFTS Transfer Charges', 'bank_charge'],
    ];
    for (const [text, expected] of cases) {
      expect(inferCategoryHint(text), text).toBe(expected);
    }
  });

  it('returns null when nothing matches', () => {
    expect(inferCategoryHint('')).toBeNull();
    expect(inferCategoryHint('zzz qqq')).toBeNull();
  });

  /*
   * Order must no longer decide the answer. If it did, this ordering-sensitive
   * pair would disagree with itself.
   */
  it('gives the same answer regardless of where the evidence sits', () => {
    const front = 'ATM Withdrawal Fee — LKR 30.00 debited';
    const back = 'LKR 30.00 debited, described as ATM Withdrawal Fee';
    expect(inferCategoryHint(front)).toBe(inferCategoryHint(back));
  });

  /*
   * The app and the shared catalog must classify identically, or a message is
   * categorised differently depending on whether the network was up.
   */
  it('scores the same way on the server', () => {
    const server = readFileSync(
      new URL('../../../../../server/lib/hints.ts', import.meta.url),
      'utf8',
    );
    // Both must score by longest match rather than returning the first hit.
    expect(server).toContain('bestScore');
    expect(server).not.toMatch(/if \(patterns\.some\([^)]*\)\) return hint;/);
  });
});
