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

/**
 * Captured from the user's real device: NDB "Online", numbered ...6796, still
 * carrying a stale last4 of 3824 from an edit made before the tail was derived
 * from the visible field. The board owed it 282,533.59 and the user sent
 * 282,534 — the case this whole feature exists for.
 */
const online: PendingAccount = {
  cardId: 'card-online',
  toTransferMinor: 28_253_359,
  last4: '3824',
  accountNumber: '106001916796',
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
  it('refuses an amount that is close but not the rounded figure', () => {
    expect(matchTransferToAccount(credit({ amountMinor: 15_834_699 }), [spending])).toBeNull();
    expect(matchTransferToAccount(credit({ amountMinor: 15_834_800 }), [spending])).toBeNull();
  });

  /**
   * The board asks for 282,533.59; nobody types that. Accepting the rounding UP
   * to the next whole unit is what lets the real transfer be recognised.
   */
  it('accepts the amount rounded up to the next whole unit', () => {
    const match = matchTransferToAccount(
      { account: 'XXXXXXXX6796', amountMinor: 28_253_400, isCredit: true },
      [online],
    );
    expect(match?.cardId).toBe('card-online');
  });

  /** A SHORT transfer has not settled the account; saying so would hide it. */
  it('refuses an amount below what is owed', () => {
    expect(
      matchTransferToAccount(
        { account: 'XXXXXXXX6796', amountMinor: 28_253_300, isCredit: true },
        [online],
      ),
    ).toBeNull();
  });

  /**
   * The stale-tail case: last4 says 3824 but the number ends 6796, and the
   * message quotes 6796. Matching the full number is what saves it.
   */
  it('matches on the full account number when the stored tail is stale', () => {
    const match = matchTransferToAccount(
      { account: 'XXXXXXXX6796', amountMinor: 28_253_400, isCredit: true },
      [online],
    );
    expect(match?.cardId).toBe('card-online');
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

/**
 * Bank fees riding along with the transfer.
 *
 * A CEFTS/SLIPS transfer often arrives with the bank's own charge bundled in,
 * so the credit is a few rupees ABOVE what the board asked for. Those are fixed
 * amounts, which is what makes allowing them safe: the window stays a few
 * rupees wide however large the transfer is.
 */
describe('bank charges', () => {
  const owed: PendingAccount = {
    cardId: 'card-x',
    toTransferMinor: 28_253_359,
    last4: '6796',
  };
  const credit = (amountMinor: number) => ({
    account: 'XXXXXXXX6796',
    amountMinor,
    isCredit: true,
  });

  it('accepts the rounded figure plus a 25 charge', () => {
    expect(matchTransferToAccount(credit(28_253_400 + 25_00), [owed])?.cardId).toBe('card-x');
  });

  it('accepts the rounded figure plus a 30 charge', () => {
    expect(matchTransferToAccount(credit(28_253_400 + 30_00), [owed])?.cardId).toBe('card-x');
  });

  it('accepts the exact figure plus a charge', () => {
    expect(matchTransferToAccount(credit(28_253_359 + 25_00), [owed])?.cardId).toBe('card-x');
  });

  /**
   * Only the real fee amounts, not a range. A tolerance of "up to 30" would
   * also swallow a genuinely different payment landing inside it.
   */
  it('rejects an amount between the known fees', () => {
    expect(matchTransferToAccount(credit(28_253_400 + 17_00), [owed])).toBeNull();
  });

  it('rejects an amount above every known fee', () => {
    expect(matchTransferToAccount(credit(28_253_400 + 500_00), [owed])).toBeNull();
  });

  /** Short is still short — a fee cannot make an underpayment settle. */
  it('rejects an amount below what is owed', () => {
    expect(matchTransferToAccount(credit(28_253_359 - 25_00), [owed])).toBeNull();
  });
});
