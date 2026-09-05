import { describe, expect, it } from 'vitest';
import {
  fragmentIdentifies,
  isForeignAccountMessage,
  isBetweenOwnAccounts,
  ownerOfAccount,
  type OwnedAccount,
} from '../accountMasks';

/**
 * The masking shapes, all captured from real messages on one device.
 *
 * They are the reason a single "ends with the card's last-4" test is not
 * enough — banks reveal different ends of the number, and one reveals too
 * little to identify anything at all.
 */
const accounts: OwnedAccount[] = [
  // DFCC, dual currency: LKR ...5584 and USD ...7427.
  { id: 'dfcc', accountNumber: '102060635584', last4: '5584', foreignAccountNumber: '102007417427', foreignLast4: '7427' },
  // NDB, carrying a STALE tail from an edit before last4 was re-derived.
  { id: 'ndb', accountNumber: '106001916796', last4: '3824' },
  { id: 'hnb', accountNumber: '138020174150', last4: '4150' },
];

describe('fragmentIdentifies', () => {
  it('matches a front-masked suffix', () => {
    expect(fragmentIdentifies('5584', '102060635584')).toBe(true);
    expect(fragmentIdentifies('7427', '102007417427')).toBe(true);
  });

  it('matches a middle-masked prefix', () => {
    expect(fragmentIdentifies('13802', '138020174150')).toBe(true);
  });

  it('does not match an unrelated number', () => {
    expect(fragmentIdentifies('5584', '106001916796')).toBe(false);
  });

  /**
   * "13802XXXXX50" reveals only two digits. Below four, a fragment is shared by
   * too many real accounts to mean anything — an honest "cannot tell" beats a
   * guess that pairs unrelated accounts.
   */
  it('refuses a fragment too short to identify anything', () => {
    expect(fragmentIdentifies('50', '138020174150')).toBe(false);
  });

  it('ignores mask characters and separators', () => {
    expect(fragmentIdentifies('XXXXXXXX5584', '1020-6063-5584')).toBe(true);
  });
});

describe('ownerOfAccount', () => {
  it('resolves either leg of a dual-currency account', () => {
    expect(ownerOfAccount(accounts, 'XXXXXXXX5584')?.id).toBe('dfcc');
    expect(ownerOfAccount(accounts, '********7427')?.id).toBe('dfcc');
  });

  /**
   * The stale-tail case, captured from the device: last4 says 3824, the number
   * ends 6796, and the message quotes 6796. Checking the FULL number is what
   * makes this resolve at all.
   */
  it('matches on the full number when the stored tail is stale', () => {
    expect(ownerOfAccount(accounts, 'XXXXXXXX6796')?.id).toBe('ndb');
  });

  it('is null for an account the user does not hold', () => {
    expect(ownerOfAccount(accounts, 'XXXXXXXX5891')).toBeNull();
  });

  it('is null for a fragment too short to identify anything', () => {
    expect(ownerOfAccount(accounts, '50')).toBeNull();
    expect(ownerOfAccount(accounts, null)).toBeNull();
  });
});

describe('isBetweenOwnAccounts', () => {
  /**
   * The real transfer this exists for: LKR 282,534 from DFCC ...5584 to NDB
   * ...6796 on 02 Sep. One internal move, which surfaced as two separate
   * spends before the full numbers were consulted.
   */
  it('recognises the DFCC to NDB transfer as internal', () => {
    expect(
      isBetweenOwnAccounts({
        accounts,
        fromFragment: '********5584',
        toFragment: 'XXXXXXXX6796',
      }),
    ).toBe(true);
  });

  it('does not treat a payment to a stranger as internal', () => {
    expect(
      isBetweenOwnAccounts({ accounts, fromFragment: '5584', toFragment: '5891' }),
    ).toBe(false);
  });

  /** A debit and a credit on ONE account is two transactions, not a transfer. */
  it('requires two different accounts', () => {
    expect(
      isBetweenOwnAccounts({ accounts, fromFragment: '5584', toFragment: '5584' }),
    ).toBe(false);
  });

  it('cannot tell when either end is missing', () => {
    expect(isBetweenOwnAccounts({ accounts, fromFragment: '5584', toFragment: null })).toBe(false);
  });
});

/**
 * Hiding a stranger's alerts, for a phone number the carrier reassigned.
 *
 * The safety bar is high: silently discarding a REAL transaction is far worse
 * than showing a stray one, because a message the user never sees is money
 * missing from the board with nothing to explain the gap. So every uncertain
 * case must resolve to "keep it".
 */
describe('isForeignAccountMessage', () => {
  it('flags an account the user does not hold', () => {
    expect(isForeignAccountMessage({ accounts, fragment: 'XXXXXXXX5891' })).toBe(true);
  });

  it('keeps a message about an account the user holds', () => {
    expect(isForeignAccountMessage({ accounts, fragment: 'XXXXXXXX5584' })).toBe(false);
    expect(isForeignAccountMessage({ accounts, fragment: 'XXXXXXXX6796' })).toBe(false);
  });

  it('keeps a message matching the foreign leg of a dual-currency account', () => {
    expect(isForeignAccountMessage({ accounts, fragment: '********7427' })).toBe(false);
  });

  /**
   * HNB prints "13802XXXXX40", revealing two digits.
   *
   * Those cannot IDENTIFY an account, but they can still rule one out: no
   * account the user holds ends in 40, so the message is not about any of
   * them. The real case — a LKR 10,000 credit to a relative's HNB account,
   * arriving on the user's phone because their number is on that bank's alert
   * list.
   */
  it('flags a short fragment that matches none of the user’s accounts', () => {
    expect(isForeignAccountMessage({ accounts, fragment: '40' })).toBe(true);
  });

  /**
   * The other side of that: a short fragment that DOES match one of the user's
   * accounts is theirs, and hiding it would drop a real transaction.
   */
  it('keeps a short fragment that matches an account the user holds', () => {
    // hnb ends 4150, so a message revealing "50" could be theirs.
    expect(isForeignAccountMessage({ accounts, fragment: '50' })).toBe(false);
  });

  /**
   * With no account numbers recorded, "matches nothing" describes the app's own
   * emptiness rather than the message — every real transaction would be
   * discarded on a board the user simply had not finished setting up.
   */
  it('keeps everything when no account numbers are known', () => {
    expect(isForeignAccountMessage({ accounts: [], fragment: '5891' })).toBe(false);
    expect(
      isForeignAccountMessage({ accounts: [{ id: 'a' }, { id: 'b' }], fragment: '5891' }),
    ).toBe(false);
  });

  it('keeps a message with no account at all', () => {
    expect(isForeignAccountMessage({ accounts, fragment: null })).toBe(false);
    expect(isForeignAccountMessage({ accounts, fragment: '' })).toBe(false);
  });
});
