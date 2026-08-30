import { describe, expect, it } from 'vitest';
import { accountLabel, accountName, accountShortName } from '../banks';

/**
 * What an account is CALLED, everywhere it is listed.
 *
 * An account carries exactly two pieces of identity: the BANK it is at, and the
 * user's own name for it. There used to be a third — a free-text `name` column
 * alongside the nickname — and the ranking had to guess which of the two the
 * user meant as the headline, using string length as the tie-break. Asking once
 * removed the guess, and these tests pin the resulting rule:
 *
 *   nickname set  → nickname leads, bank underneath (this is what tells three
 *                   accounts at one bank apart)
 *   no nickname   → the bank leads, and there is nothing to put underneath
 */
describe('accountLabel', () => {
  it('leads with the nickname when one is set', () => {
    expect(accountLabel({ bankName: 'HNB', nickname: 'Salary' })).toEqual({
      primary: 'Salary',
      secondary: 'HNB',
    });
  });

  // The bank has to survive as the secondary line: a list of bare nicknames
  // cannot be checked against a banking app.
  it('keeps the bank as the secondary line so the account stays identifiable', () => {
    const label = accountLabel({ bankName: 'Sampath', nickname: 'Joint' });
    expect(label.primary).toBe('Joint');
    expect(label.secondary).toBe('Sampath');
  });

  it('leads with the bank when no nickname is set', () => {
    expect(accountLabel({ bankName: 'HNB' })).toEqual({ primary: 'HNB', secondary: null });
  });

  it('ignores a blank or whitespace-only nickname', () => {
    expect(accountLabel({ bankName: 'HNB', nickname: '   ' }).primary).toBe('HNB');
    expect(accountLabel({ bankName: 'HNB', nickname: '' }).primary).toBe('HNB');
  });

  it('treats an absent nickname field as no nickname', () => {
    expect(accountLabel({ bankName: 'HNB' }).primary).toBe('HNB');
  });

  it('resolves the bank from the catalog id when no bank name is stored', () => {
    const label = accountLabel({ bankId: 'hnb' });
    expect(label.primary).toBeTruthy();
    expect(label.primary).not.toBe('');
  });

  // An account with neither a bank nor a nickname still has to render as
  // something rather than collapsing to an empty row.
  it('falls back to the neutral brand when nothing identifies the account', () => {
    const label = accountLabel({});
    expect(label.primary).toBeTruthy();
    expect(label.secondary).toBeNull();
  });

  it('uses the nickname alone when there is no bank at all', () => {
    expect(accountLabel({ nickname: 'Cash tin' })).toEqual({
      primary: 'Cash tin',
      secondary: null,
    });
  });
});

describe('accountName', () => {
  it('is the label primary', () => {
    expect(accountName({ bankName: 'HNB', nickname: 'Salary' })).toBe('Salary');
    expect(accountName({ bankName: 'HNB' })).toBe('HNB');
  });
});

describe('accountShortName', () => {
  it('prefers the nickname', () => {
    expect(accountShortName({ bankId: 'hnb', nickname: 'Salary' })).toBe('Salary');
  });

  // The point of the short form: the catalog's short name, not the long
  // official one, for rows with room for a word.
  it("falls back to the bank's SHORT name, not its full name", () => {
    const brandShort = accountShortName({ bankId: 'boc' });
    expect(brandShort.length).toBeLessThanOrEqual('Bank of Ceylon'.length);
  });
});
