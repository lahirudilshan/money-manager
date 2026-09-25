import { describe, expect, it } from 'vitest';
import { parseSms } from '~/features/sms/logic/smsParser';
import { inferCategoryHint } from '~/features/sms/logic/smsCategoryHints';
import { matchMerchant, type MerchantRule } from '~/features/sms/logic/merchantRules';

/**
 * A fuel purchase suggested as a water bill.
 *
 * LKR 15,485 at "L.I.O.C.FILLING STATION PELIYAGODA" arrived proposing the
 * Water bill line. Two faults compounded, and either alone would have been
 * survivable:
 *
 * 1. The payee clause stopped at the first `.`, so an initialism collapsed to
 *    its first letter and the merchant parsed as "L".
 * 2. `matchMerchant`'s containment pass guarded the length of the RULE pattern
 *    but not of the key, so a one-character key matched any rule containing
 *    that letter. "L" is inside "nationa(l) water supply and drainage board".
 *
 * The result carried `likely` confidence, because a rule match outranks the
 * keyword read — and the keyword read was right all along: the message says
 * "FILLING STATION", which is a fuel pattern.
 */

const LIOC =
  'Dear MR M N LAHIRU DILSHAN,LKR 15,485.00 Debited from your A/c XXXXXXXX5891 ' +
  'on 25/09/2026 at 19:48.AvlBal LKR 362,693.93. @ L.I.O.C.FILLING STATION ' +
  'PELIYAGODA. ATM POS Transaction.Thank you for banking with us.Call Centre 1972.';

const rule = (pattern: string, hint: string): MerchantRule =>
  ({
    id: pattern,
    pattern,
    subcategoryId: null,
    hint,
    source: 'seed',
    hitCount: 0,
    updatedAt: 0,
  }) as MerchantRule;

describe('a merchant written as an initialism', () => {
  it('keeps the whole name rather than stopping at the first dot', () => {
    expect(parseSms(LIOC)?.merchant).toBe('L.I.O.C.FILLING STATION PELIYAGODA');
  });

  it('reads as fuel, which is what the message says', () => {
    const parsed = parseSms(LIOC);
    expect(inferCategoryHint(`${parsed?.merchant} ${parsed?.raw}`)).toBe('fuel');
  });

  /*
   * The ordinary case this clause was written for, which must keep working:
   * a payee with no initialism still ends at its sentence.
   */
  it('still stops at the sentence end for a plain payee', () => {
    const plain =
      'Dear Customer, LKR 2,500.00 Debited from your A/c XXXX1234 on 01/09/2026 ' +
      'at 10:00.AvlBal LKR 10,000.00. @ A S P Pharmacy & Grocery Kelaniya. ' +
      'ATM POS Transaction.Thank you.';
    expect(parseSms(plain)?.merchant).toBe('A S P Pharmacy & Grocery Kelaniya');
  });
});

describe('matchMerchant containment', () => {
  const rules = [
    rule('national water supply and drainage board', 'water'),
    rule('ioc', 'fuel'),
  ];

  /*
   * The second half of the bug. Even with the parser fixed, any future message
   * that yields a one- or two-character merchant must not match by
   * containment: every short string is a substring of something.
   */
  it('does not match a one-character merchant against a long rule', () => {
    expect(matchMerchant('L', rules).hint).toBeNull();
  });

  it('does not match a two-character merchant either', () => {
    expect(matchMerchant('na', rules).hint).toBeNull();
  });

  it('still matches a three-character merchant', () => {
    expect(matchMerchant('IOC', rules).hint).toBe('fuel');
  });

  it('still matches a longer merchant by containment', () => {
    expect(matchMerchant('National Water Supply and Drainage Board', rules).hint).toBe(
      'water',
    );
  });

  /* An exact match is a separate pass and was never length-limited. */
  it('leaves exact matching alone', () => {
    expect(matchMerchant('ioc', rules).confidence).toBe('exact');
  });
});
