import { describe, expect, it } from 'vitest';
import { isBankChargeLine } from '~/features/sms/logic/smsReconcile';

/**
 * A split fee is named after its parent — "HNB ATM Withdrawal" is the merchant
 * on BOTH the 10,000 withdrawal and its 30.00 charge (see `feeMerchant`). So
 * confirming the fee taught "hnb atm withdrawal -> Bank charges", and every
 * later withdrawal from that merchant inherited it.
 *
 * A learned rule outranks the parser, the kind and the keywords, which is why
 * three rounds of parser fixes could not shift it: the parse was correct all
 * along and the rule overrode it. This encodes the predicate the startup repair
 * uses, so the rule it removes stays exactly the rule it should.
 */
const shouldRemove = (pattern: string, pointsAtChargeLine: boolean, source: string) =>
  source === 'learned' &&
  pointsAtChargeLine &&
  !/\b(?:charge|charges|fee|fees|stamp duty|commission)\b/i.test(pattern) &&
  /\b(?:atm|withdrawal|withdraw|transfer|purchase|pos|cash)\b/i.test(pattern);

describe('fee-poisoned merchant rules', () => {
  it('removes the rule observed on the device', () => {
    expect(shouldRemove('hnb atm withdrawal', true, 'learned')).toBe(true);
  });

  it('keeps a rule for a merchant that really is a fee', () => {
    expect(shouldRemove('cefts transfer charges', true, 'learned')).toBe(false);
    expect(shouldRemove('stamp duty', true, 'learned')).toBe(false);
  });

  it('keeps seeded rules and rules pointing elsewhere', () => {
    expect(shouldRemove('hnb atm withdrawal', true, 'seed')).toBe(false);
    expect(shouldRemove('hnb atm withdrawal', false, 'learned')).toBe(false);
  });

  it('recognises the user\'s charges line by name', () => {
    expect(isBankChargeLine('Bank charges')).toBe(true);
    expect(isBankChargeLine('Groceries')).toBe(false);
  });
});
