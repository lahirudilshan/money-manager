import { describe, expect, it } from 'vitest';
import { matchTransferToAccount, type PendingAccount } from '../autoTransfer';

/**
 * Auto-marking an account "moved" from the bank's own confirmation.
 *
 * The dashboard says move LKR 158,347 onto Spending; the user does it; the bank
 * texts to confirm. Requiring the ACCOUNT and the AMOUNT to both match exactly
 * is what makes acting on that safe without asking — this writes board state
 * nobody confirmed, so every uncertain case must resolve to "do nothing".
 */

const spending: PendingAccount = {
  cardId: 'card-spending',
  toTransferMinor: 15_834_700,
  last4: '7427',
};

const savings: PendingAccount = {
  cardId: 'card-savings',
  toTransferMinor: 7_433_300,
  last4: '7218',
};

const credit = (over: Partial<Parameters<typeof matchTransferToAccount>[0]> = {}) => ({
  account: 'XXXXXXXX7427',
  amountMinor: 15_834_700,
  isCredit: true,
  ...over,
});

describe('matchTransferToAccount', () => {
  it('matches on account and exact amount together', () => {
    expect(matchTransferToAccount(credit(), [spending, savings])?.cardId).toBe('card-spending');
  });

  it('matches the foreign leg of a dual-currency account', () => {
    const dual: PendingAccount = { ...spending, last4: '0000', foreignLast4: '7427' };
    expect(matchTransferToAccount(credit(), [dual])?.cardId).toBe('card-spending');
  });

  /**
   * No tolerance. A near-match is a different transfer that happens to be
   * close, and marking a month funded on "close enough" hides a shortfall the
   * user has no reason to look for.
   */
  it('refuses an amount that is close but not exact', () => {
    expect(matchTransferToAccount(credit({ amountMinor: 15_834_699 }), [spending])).toBeNull();
    expect(matchTransferToAccount(credit({ amountMinor: 15_834_701 }), [spending])).toBeNull();
  });

  it('refuses when the account does not match', () => {
    expect(matchTransferToAccount(credit({ account: 'XXXX9999' }), [spending])).toBeNull();
  });

  /** A debit is the user spending, not funding — and would match its own account. */
  it('ignores money leaving an account', () => {
    expect(matchTransferToAccount(credit({ isCredit: false }), [spending])).toBeNull();
  });

  /**
   * An account with nothing outstanding has no transfer to confirm; matching
   * one would mark an already-settled month "moved" a second time.
   */
  it('ignores an account that is already fully funded', () => {
    const settled: PendingAccount = { ...spending, toTransferMinor: 0 };
    expect(matchTransferToAccount(credit({ amountMinor: 0 }), [settled])).toBeNull();
  });

  /**
   * Two accounts owed the same amount and both matching cannot be told apart,
   * and picking either would be a coin flip written into the board.
   */
  it('refuses to guess between two equally good matches', () => {
    const twin: PendingAccount = { cardId: 'card-twin', toTransferMinor: 15_834_700, last4: '7427' };
    expect(matchTransferToAccount(credit(), [spending, twin])).toBeNull();
  });

  it('refuses a message with no destination account', () => {
    expect(matchTransferToAccount(credit({ account: null }), [spending])).toBeNull();
  });

  it('refuses a non-positive or unusable amount', () => {
    expect(matchTransferToAccount(credit({ amountMinor: 0 }), [spending])).toBeNull();
    expect(matchTransferToAccount(credit({ amountMinor: Number.NaN }), [spending])).toBeNull();
  });

  it('refuses a fragment too short to identify an account', () => {
    expect(matchTransferToAccount(credit({ account: '27' }), [spending])).toBeNull();
  });

  it('returns null when there are no pending accounts at all', () => {
    expect(matchTransferToAccount(credit(), [])).toBeNull();
  });
});
