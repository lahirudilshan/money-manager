import { describe, expect, it } from 'vitest';
import { accountLabel } from '../banks';

/**
 * `accountLabel` decides what every account row, picker and detail header
 * leads with. The nickname rule is the point of these tests: a user with
 * several accounts at one bank needs their own word first, without losing the
 * bank identity that lets them check the figure against a banking app.
 */
describe('accountLabel', () => {
  it('leads with the nickname when one is set', () => {
    expect(
      accountLabel({ bankName: 'HNB', nickname: 'Salary', name: 'HNB Current' }),
    ).toEqual({ primary: 'Salary', secondary: 'HNB' });
  });

  it('keeps the bank as the secondary line so the account stays identifiable', () => {
    const label = accountLabel({ bankName: 'Sampath', nickname: 'Joint', name: 'Sampath' });
    expect(label.primary).toBe('Joint');
    expect(label.secondary).toBe('Sampath');
  });

  it('ignores a blank or whitespace-only nickname', () => {
    expect(accountLabel({ bankName: 'HNB', nickname: '   ', name: 'HNB' }).primary).toBe('HNB');
    expect(accountLabel({ bankName: 'HNB', nickname: '', name: 'HNB' }).primary).toBe('HNB');
  });

  it('falls back to the account name when there is a nickname but no bank', () => {
    const label = accountLabel({ bankName: null, nickname: 'Cash tin', name: 'Wallet' });
    expect(label.primary).toBe('Cash tin');
    expect(label.secondary).toBe('Wallet');
  });

  it('does not repeat the name as the secondary when it equals the nickname', () => {
    const label = accountLabel({ bankName: null, nickname: 'Wallet', name: 'Wallet' });
    expect(label.primary).toBe('Wallet');
    expect(label.secondary).toBeNull();
  });

  // Pre-existing behaviour, unchanged — pinned so the nickname work cannot
  // quietly alter how an un-nicknamed account reads.
  it('leads with the bank when no nickname is set', () => {
    expect(accountLabel({ bankName: 'HNB', name: 'Salary account' })).toEqual({
      primary: 'HNB',
      secondary: 'Salary account',
    });
  });

  it('omits the secondary when the name matches the bank', () => {
    expect(accountLabel({ bankName: 'HNB', name: 'HNB' }).secondary).toBeNull();
  });

  it('uses the name alone for a hand-typed account matching no bank', () => {
    expect(accountLabel({ bankName: null, name: 'Biscuit tin' })).toEqual({
      primary: 'Biscuit tin',
      secondary: null,
    });
  });

  it('treats an absent nickname field as no nickname', () => {
    // Rows written before the column existed have `nickname` undefined.
    expect(accountLabel({ bankName: 'HNB', name: 'Salary' }).primary).toBe('HNB');
  });
});
