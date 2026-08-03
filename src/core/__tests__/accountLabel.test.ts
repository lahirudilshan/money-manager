import { describe, expect, it } from 'vitest';
import { accountLabel } from '../../data/banks';

/**
 * What an account is CALLED, everywhere it is listed.
 *
 * The headline should always be the string the user would use for this account
 * themselves. That is not always the bank's official name: someone who types
 * "BOC" as the account name has abbreviated "Bank of Ceylon" deliberately, and
 * echoing the long form back at them both ignores the choice and crowds out the
 * figure sitting beside it in a list row.
 */

describe('accountLabel', () => {
  /** A nickname is the strongest signal — it exists only to distinguish. */
  it('leads with the nickname when one is set', () => {
    const label = accountLabel({
      name: 'BOC',
      nickname: 'Salary',
      bankName: 'Bank of Ceylon',
      bankId: 'boc',
    });

    expect(label.primary).toBe('Salary');
    expect(label.secondary).toBe('Bank of Ceylon');
  });

  /**
   * The case that prompted this: a short self-chosen name against a long
   * official one.
   */
  it('prefers a shorter self-chosen name over the official bank name', () => {
    const label = accountLabel({ name: 'BOC', bankName: 'Bank of Ceylon', bankId: 'boc' });

    expect(label.primary).toBe('BOC');
    expect(label.secondary).toBe('Bank of Ceylon');
  });

  /**
   * The inverse. A longer, more descriptive account name is NOT an
   * abbreviation, so the bank stays the headline and the description follows.
   */
  it('keeps the bank as headline when the account name is longer', () => {
    const label = accountLabel({
      name: 'Joint current account',
      bankName: 'HNB',
      bankId: 'hnb',
    });

    expect(label.primary).toBe('HNB');
    expect(label.secondary).toBe('Joint current account');
  });

  /** Nothing to choose between when they match. */
  it('shows the bank once when the name repeats it', () => {
    const label = accountLabel({ name: 'HNB', bankName: 'HNB', bankId: 'hnb' });

    expect(label.primary).toBe('HNB');
    expect(label.secondary).toBeNull();
  });

  /**
   * A hand-typed account with no recognised bank stands on its own.
   *
   * The name deliberately matches nothing in the bank catalog — "Cash box"
   * resolves to the real "Cash in hand" brand, which is the catalog working as
   * intended rather than a labelling bug.
   */
  it('falls back to the account name with no bank', () => {
    const label = accountLabel({ name: 'Envelope under mattress', bankName: null, bankId: null });

    expect(label.primary).toBe('Envelope under mattress');
    expect(label.secondary).toBeNull();
  });

  /** Whitespace must not defeat the comparison or leak into the label. */
  it('ignores surrounding whitespace on the name', () => {
    const label = accountLabel({ name: '  BOC  ', bankName: 'Bank of Ceylon', bankId: 'boc' });

    expect(label.primary).toBe('BOC');
  });

  /** A blank nickname is not a nickname. */
  it('ignores an empty nickname', () => {
    const label = accountLabel({
      name: 'BOC',
      nickname: '   ',
      bankName: 'Bank of Ceylon',
      bankId: 'boc',
    });

    expect(label.primary).toBe('BOC');
  });
});
