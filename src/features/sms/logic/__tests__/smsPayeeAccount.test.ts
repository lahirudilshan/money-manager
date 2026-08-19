import { describe, expect, it } from 'vitest';
import { parseSms } from '~/features/sms/logic/smsParser';
import { reconcileSms } from '~/features/sms/logic/smsReconcile';
import { payeeAccountKey, type MerchantRule } from '~/features/sms/logic/merchantRules';

const BOARD = {
  subcategories: [
    { id: 'rent', name: 'Rent / mortgage', categoryId: 'hou', type: 'expense', plannedMinor: 0 },
    { id: 'groc', name: 'Groceries', categoryId: 'liv', type: 'expense', plannedMinor: 0 },
  ],
  categories: [{ id: 'hou', name: 'Housing' }, { id: 'liv', name: 'Living' }],
  cards: [],
} as never;

// The real unnamed transfer from the device backup.
const RAW = 'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 12:00:49 Reason:MB:ref Bal:LKR 395,732.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462';

describe('payee-account tier, end to end', () => {
  it('is unresolved before anything is learned', () => {
    const p = parseSms(RAW)!;
    const d = reconcileSms(p, BOARD, 'a', []);
    expect(d.subcategoryId).toBeFalsy();
  });

  it('recognises the payee after ONE confirmation', () => {
    const p = parseSms(RAW)!;
    const taught = [{
      id: 'r1', pattern: payeeAccountKey(p.payeeAccount!), subcategoryId: 'rent',
      hint: null, hitCount: 1, updatedAt: 2, source: 'user',
    }] as unknown as MerchantRule[];
    const d = reconcileSms(p, BOARD, 'b', taught);
    expect(d.subcategoryId).toBe('rent');
    // Suggestion, not certainty: the same account can receive different things.
    expect(d.confidence).toBe('likely');
  });

  it('does not let a payee rule override a named merchant', () => {
    const pos = parseSms('LKR 2,395.76 debited ... at KEELLS SUPER - SINHARAMUL, LK. Avl Bal 100.00')!;
    const taught = [{
      id: 'r1', pattern: payeeAccountKey('13802XXXXX50'), subcategoryId: 'rent',
      hint: null, hitCount: 9, updatedAt: 9, source: 'user',
    }] as unknown as MerchantRule[];
    const d = reconcileSms(pos, BOARD, 'c', taught);
    expect(d.subcategoryId).not.toBe('rent');
  });
});
