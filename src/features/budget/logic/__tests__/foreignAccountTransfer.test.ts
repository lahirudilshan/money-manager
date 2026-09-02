import { describe, expect, it } from 'vitest';
import { accountCurrency, fromHomeMinor } from '~/features/accounts/logic/accountCurrency';

/**
 * A USD salary account beside an LKR spending account, at the same bank.
 *
 * The real setup: the salary arrives in a DFCC USD account, a portion is
 * converted into a DFCC LKR account, and the bills are paid from the LKR one.
 * Two accounts, one bank, different jobs — and the app has to keep their
 * figures in their own units.
 *
 * The bug this pins: "money to move" summed every line's PLANNED amount, which
 * is always in the home currency, and rendered it without a unit. Attach a bill
 * to the USD account and the row said to move "578,214" onto an account
 * denominated in dollars — a figure 323x too large, with nothing on screen to
 * give it away.
 */

const RATE = 323.25;
const USD_ACCOUNT = { currency: 'USD' };
const LKR_ACCOUNT = { currency: 'LKR' };
/** Every row that predates the currency column — implicitly the home currency. */
const LEGACY_ACCOUNT = { currency: null };

describe('a foreign account states its figures in its own currency', () => {
  it('converts a home-currency plan into the account’s currency', () => {
    // The board plans LKR 578,214.00; the USD account receives $1,788.75.
    expect(fromHomeMinor(57_821_400, USD_ACCOUNT, 'LKR', RATE)).toBe(178_875);
  });

  it('leaves the LKR spending account exactly as planned', () => {
    expect(fromHomeMinor(57_821_400, LKR_ACCOUNT, 'LKR', RATE)).toBe(57_821_400);
  });

  it('leaves an account created before the currency column alone', () => {
    expect(fromHomeMinor(57_821_400, LEGACY_ACCOUNT, 'LKR', RATE)).toBe(57_821_400);
  });

  it('labels each account with what it actually holds', () => {
    expect(accountCurrency(USD_ACCOUNT, 'LKR')).toBe('USD');
    expect(accountCurrency(LKR_ACCOUNT, 'LKR')).toBe('LKR');
    expect(accountCurrency(LEGACY_ACCOUNT, 'LKR')).toBe('LKR');
  });
});

describe('cross-account totals stay in one unit', () => {
  /**
   * The reason `AccountTransferView` carries BOTH `toTransferMinor` (the
   * account's own currency, for its row) and `toTransferHomeMinor` (the home
   * currency, for sums). Adding the per-account figures would add dollars to
   * rupees and produce a number that is not money in any unit.
   */
  it('sums the home figures, never the converted ones', () => {
    const rows = [
      { toTransferHomeMinor: 15_834_700, account: USD_ACCOUNT },
      { toTransferHomeMinor: 28_253_400, account: LKR_ACCOUNT },
    ];

    const home = rows.reduce((sum, row) => sum + row.toTransferHomeMinor, 0);
    expect(home).toBe(44_088_100);

    // What summing the CONVERTED figures would have produced — dollars plus
    // rupees, off by two orders of magnitude and meaningless as an amount.
    const wrong = rows.reduce(
      (sum, row) => sum + fromHomeMinor(row.toTransferHomeMinor, row.account, 'LKR', RATE),
      0,
    );
    expect(wrong).not.toBe(home);
    expect(wrong).toBeLessThan(home);
  });
});

describe('an account in a currency the app has no rate for', () => {
  /**
   * The app stores exactly one rate (USD). A third currency has nothing to
   * convert by, so the figure passes through in home units and the row is
   * flagged rather than presenting a confidently wrong number.
   */
  it('passes the figure through unconverted', () => {
    expect(fromHomeMinor(57_821_400, { currency: 'GBP' }, 'LKR', RATE)).toBe(57_821_400);
  });

  it('is detectable as needing a rate', () => {
    const held = accountCurrency({ currency: 'GBP' }, 'LKR');
    expect(held !== 'LKR' && held !== 'USD').toBe(true);
  });
});
