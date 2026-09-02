import { describe, expect, it } from 'vitest';
import {
  cardOwnsAccount,
  isDualCurrency,
  isSelfConversion,
  ownedCardFor,
  validateAccountNumber,
  type DualCurrencyCard,
} from '../dualCurrency';

/**
 * The setup: a DFCC relationship holding USD and LKR.
 *
 * Some banks put both currencies behind one number, some issue two. Both shapes
 * are one card row — the second number is optional.
 */
const twoNumbers: DualCurrencyCard = {
  id: 'dfcc',
  last4: '7427',
  currency: 'LKR',
  foreignLast4: '9915',
  foreignCurrency: 'USD',
};

const oneNumber: DualCurrencyCard = {
  id: 'boc',
  last4: '5566',
  currency: 'LKR',
  foreignLast4: null,
  foreignCurrency: 'USD',
};

const plain: DualCurrencyCard = { id: 'hnb', last4: '4150', currency: null };

describe('cardOwnsAccount', () => {
  it('matches the primary number', () => {
    expect(cardOwnsAccount(twoNumbers, 'XXXXXXXX7427')).toBe(true);
  });

  it('matches the foreign number', () => {
    expect(cardOwnsAccount(twoNumbers, 'XXXXXXXX9915')).toBe(true);
  });

  it('does not match an account the user does not hold', () => {
    expect(cardOwnsAccount(twoNumbers, 'XXXXXXXX1234')).toBe(false);
  });

  /**
   * A fragment shorter than four digits identifies nothing — "50" would match
   * any account ending in 50, which is most of them.
   */
  it('refuses a fragment too short to identify anything', () => {
    expect(cardOwnsAccount({ id: 'x', last4: '50' }, 'XXXX50')).toBe(false);
    expect(cardOwnsAccount(twoNumbers, '27')).toBe(false);
  });

  it('ignores masking characters around the digits', () => {
    expect(cardOwnsAccount(twoNumbers, 'AC XXXXXXXX-7427')).toBe(true);
  });
});

describe('isDualCurrency', () => {
  it('is true when a foreign currency is named, with or without a second number', () => {
    expect(isDualCurrency(twoNumbers)).toBe(true);
    expect(isDualCurrency(oneNumber)).toBe(true);
  });

  it('is false for an ordinary single-currency account', () => {
    expect(isDualCurrency(plain)).toBe(false);
  });
});

describe('isSelfConversion', () => {
  const cards = [twoNumbers, plain];

  /**
   * The case this exists for: converting USD into LKR between the two legs of
   * one relationship. Both ends are the user's, so no money left the household
   * and counting it would invent an expense.
   */
  it('recognises a move between the two legs of one account', () => {
    expect(
      isSelfConversion({ cards, fromAccount: 'XXXX9915', toAccount: 'XXXX7427' }),
    ).toBe(true);
  });

  it('recognises a move between two accounts the user owns', () => {
    expect(
      isSelfConversion({ cards, fromAccount: 'XXXX7427', toAccount: 'XXXX4150' }),
    ).toBe(true);
  });

  /** Money to someone else is a real expense, whatever the currency. */
  it('does NOT treat a transfer to a stranger as internal', () => {
    expect(
      isSelfConversion({ cards, fromAccount: 'XXXX7427', toAccount: 'XXXX0001' }),
    ).toBe(false);
  });

  /**
   * A message that does not say where the money went cannot be shown to be
   * internal, and guessing would silently drop a real expense.
   */
  it('does not guess when either end is missing', () => {
    expect(isSelfConversion({ cards, fromAccount: 'XXXX7427', toAccount: null })).toBe(false);
    expect(isSelfConversion({ cards, fromAccount: null, toAccount: 'XXXX7427' })).toBe(false);
    expect(isSelfConversion({ cards, fromAccount: undefined, toAccount: undefined })).toBe(false);
  });

  it('does not treat an unmatchably short fragment as owned', () => {
    expect(isSelfConversion({ cards, fromAccount: '27', toAccount: 'XXXX7427' })).toBe(false);
  });
});

describe('ownedCardFor', () => {
  it('finds the card behind either leg', () => {
    expect(ownedCardFor([twoNumbers], 'XXXX9915')?.id).toBe('dfcc');
  });

  it('is undefined for an unknown account', () => {
    expect(ownedCardFor([twoNumbers], 'XXXX0000')).toBeUndefined();
    expect(ownedCardFor([twoNumbers], null)).toBeUndefined();
  });
});

describe('validateAccountNumber', () => {
  it('accepts an ordinary account number', () => {
    expect(validateAccountNumber('102007417427')).toBeNull();
  });

  it('accepts separators people actually type', () => {
    expect(validateAccountNumber('1020 0741 7427')).toBeNull();
    expect(validateAccountNumber('1020-0741-7427')).toBeNull();
  });

  /**
   * The field is optional — an account with no number simply cannot be matched
   * to an SMS. Rejecting blank would make it behave as required.
   */
  it('accepts an empty field', () => {
    expect(validateAccountNumber('')).toBeNull();
    expect(validateAccountNumber('   ')).toBeNull();
  });

  /**
   * A letter is always a mistake here, and it fails SILENTLY later: the number
   * simply stops matching any bank message, which the user would never trace
   * back to this field.
   */
  it('rejects letters', () => {
    expect(validateAccountNumber('AC 102007417427')).toBe('Account numbers are digits only');
    expect(validateAccountNumber('1020074174XX')).toBe('Account numbers are digits only');
  });

  it('rejects stray symbols', () => {
    expect(validateAccountNumber('1020/0741')).toBe('Remove any symbols — digits only');
  });

  /** Below four digits the number cannot identify an account at all. */
  it('rejects a fragment too short to ever match', () => {
    expect(validateAccountNumber('123')).toBe('Too short — enter at least 4 digits');
  });

  it('rejects a number longer than any real account', () => {
    expect(validateAccountNumber('1'.repeat(21))).toBe('That looks too long for an account number');
  });

  it('rejects punctuation with no digits at all', () => {
    expect(validateAccountNumber('---')).toBe('Enter the account number');
  });
});
