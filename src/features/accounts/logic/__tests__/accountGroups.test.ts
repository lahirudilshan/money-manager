import { describe, expect, it } from 'vitest';
import { groupAccounts, isPaired, type GroupableCard } from '../accountGroups';

/**
 * The setup this exists for: a USD account that receives the salary and a local
 * account the bills are paid from, both at one bank.
 *
 * They stay TWO rows in storage — different currencies, balances and jobs — and
 * this only decides how the list draws them, so a pair reads as one bank
 * relationship rather than as a duplicate entry.
 */

const card = (over: Partial<GroupableCard> & { id: string }): GroupableCard => ({
  bankId: 'dfcc',
  accountNumber: null,
  last4: null,
  ...over,
});

describe('groupAccounts', () => {
  it('pairs two accounts sharing a bank and account number', () => {
    const groups = groupAccounts([
      card({ id: 'usd', accountNumber: '102007417427' }),
      card({ id: 'lkr', accountNumber: '102007417427' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.id)).toEqual(['usd', 'lkr']);
    expect(isPaired(groups[0])).toBe(true);
  });

  it('pairs on the last four when the numbers differ', () => {
    const groups = groupAccounts([
      card({ id: 'usd', last4: '7427' }),
      card({ id: 'lkr', last4: '7427' }),
    ]);

    expect(groups).toHaveLength(1);
  });

  /**
   * The case that makes bank-only grouping wrong. A salary account and a joint
   * account at one bank are two unrelated accounts, and merging them would
   * claim a relationship the user never stated.
   */
  it('does NOT pair two accounts that merely share a bank', () => {
    const groups = groupAccounts([
      card({ id: 'salary', accountNumber: '111' }),
      card({ id: 'joint', accountNumber: '222' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => !isPaired(g))).toBe(true);
  });

  it('does not pair across different banks', () => {
    const groups = groupAccounts([
      card({ id: 'a', bankId: 'dfcc', accountNumber: '111' }),
      card({ id: 'b', bankId: 'hnb', accountNumber: '111' }),
    ]);

    expect(groups).toHaveLength(2);
  });

  /** No number and no tail is no evidence — guessing would merge strangers. */
  it('leaves an account with nothing to match on standalone', () => {
    const groups = groupAccounts([card({ id: 'a' }), card({ id: 'b' })]);

    expect(groups).toHaveLength(2);
  });

  it('treats a row with no bank as standalone', () => {
    const groups = groupAccounts([
      card({ id: 'a', bankId: null, accountNumber: '111' }),
      card({ id: 'b', bankId: null, accountNumber: '111' }),
    ]);

    expect(groups).toHaveLength(2);
  });

  /**
   * A group sits where its FIRST member sat, so grouping never reorders the
   * list out from under someone who has arranged it.
   */
  it('keeps the list order, moving the second half up beside the first', () => {
    const groups = groupAccounts([
      card({ id: 'usd', accountNumber: '111' }),
      card({ id: 'other', bankId: 'hnb', accountNumber: '999' }),
      card({ id: 'lkr', accountNumber: '111' }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['usd', 'other']);
    expect(groups[0].cards.map((c) => c.id)).toEqual(['usd', 'lkr']);
  });

  it('ignores padding around a typed number', () => {
    const groups = groupAccounts([
      card({ id: 'usd', accountNumber: ' 111 ' }),
      card({ id: 'lkr', accountNumber: '111' }),
    ]);

    expect(groups).toHaveLength(1);
  });

  it('returns nothing for an empty list', () => {
    expect(groupAccounts([])).toEqual([]);
  });
});
