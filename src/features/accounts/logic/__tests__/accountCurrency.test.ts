import { describe, expect, it } from 'vitest';
import {
  accountCurrency,
  fromHomeMinor,
  isForeignAccount,
  needsRate,
  sumInHome,
  toHomeMinor,
} from '../accountCurrency';

/**
 * The three real setups this exists for:
 *
 *   1. One bank, two account numbers — an LKR savings and a USD FCBU account.
 *      Two rows, each with its own currency.
 *   2. One bank, one account number, holding both. Two rows sharing a `last4`,
 *      which the app does not need to know about: each still states what it
 *      holds.
 *   3. Everything else — a single-currency account, which is every row that
 *      existed before this column did.
 */
describe('accountCurrency', () => {
  it('uses the home currency when the account names none', () => {
    // Every pre-existing row. The column is new, so null means "made before
    // accounts had a currency", and all of those are in the user's own money.
    expect(accountCurrency({}, 'LKR')).toBe('LKR');
    expect(accountCurrency({ currency: null }, 'LKR')).toBe('LKR');
    expect(accountCurrency({ currency: '   ' }, 'LKR')).toBe('LKR');
  });

  it('uses the account own currency when it has one', () => {
    expect(accountCurrency({ currency: 'USD' }, 'LKR')).toBe('USD');
  });

  it('normalises case, so a hand-typed code still matches', () => {
    expect(accountCurrency({ currency: 'usd' }, 'LKR')).toBe('USD');
    expect(isForeignAccount({ currency: 'lkr' }, 'LKR')).toBe(false);
  });
});

describe('isForeignAccount', () => {
  it('separates the two sides of one bank', () => {
    // Case 1: HNB savings in LKR, HNB FCBU in USD.
    expect(isForeignAccount({ currency: 'LKR' }, 'LKR')).toBe(false);
    expect(isForeignAccount({ currency: 'USD' }, 'LKR')).toBe(true);
  });

  it('treats an unset currency as local', () => {
    expect(isForeignAccount({}, 'LKR')).toBe(false);
  });
});

describe('toHomeMinor', () => {
  const RATE = 300;

  it('leaves a home-currency amount untouched', () => {
    expect(toHomeMinor(500_000, { currency: 'LKR' }, 'LKR', RATE)).toBe(500_000);
    expect(toHomeMinor(500_000, {}, 'LKR', RATE)).toBe(500_000);
  });

  it('converts USD into the home currency', () => {
    // USD 1,200 at 300 = LKR 360,000.
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'LKR', RATE)).toBe(36_000_000);
  });

  it('does NOT convert a currency the app holds no rate for', () => {
    /*
     * The app stores exactly one rate. Inventing one for EUR would produce a
     * confident wrong number — worse than leaving the figure alone, because
     * nothing on screen would reveal the guess.
     */
    expect(toHomeMinor(100_000, { currency: 'EUR' }, 'LKR', RATE)).toBe(100_000);
  });

  it('refuses a nonsense rate rather than zeroing the amount', () => {
    // A rate of 0 would silently wipe a real balance to nothing.
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'LKR', 0)).toBe(120_000);
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'LKR', -5)).toBe(120_000);
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'LKR', Number.NaN)).toBe(120_000);
  });

  it('works when the home currency IS usd', () => {
    // Someone whose app currency is USD holding a USD account: no conversion.
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'USD', RATE)).toBe(120_000);
  });
});

describe('needsRate', () => {
  it('flags only a foreign currency with no stored rate', () => {
    expect(needsRate({ currency: 'EUR' }, 'LKR')).toBe(true);
    expect(needsRate({ currency: 'USD' }, 'LKR')).toBe(false);
    expect(needsRate({ currency: 'LKR' }, 'LKR')).toBe(false);
    expect(needsRate({}, 'LKR')).toBe(false);
  });
});

describe('the two-account-numbers case', () => {
  it('keeps each side of one bank account in its own currency', () => {
    /*
     * Case 2: one account number, both currencies. The app models it as two
     * rows sharing a `last4` — it does not need to know they are linked, only
     * what each one holds.
     */
    const lkrSide = { currency: 'LKR' };
    const usdSide = { currency: 'USD' };

    expect(accountCurrency(lkrSide, 'LKR')).toBe('LKR');
    expect(accountCurrency(usdSide, 'LKR')).toBe('USD');

    // A combined total converts the USD side and leaves the other alone.
    const total =
      toHomeMinor(35_000_00, lkrSide, 'LKR', 300) + toHomeMinor(1_200_00, usdSide, 'LKR', 300);
    expect(total).toBe(35_000_00 + 36_000_000);
  });
});

describe('sumInHome', () => {
  const HOME = 'LKR';
  const RATE = 300;

  it('converts USD and leaves home-currency amounts alone', () => {
    const { totalMinor, excluded } = sumInHome(
      [
        { account: { currency: null }, amountMinor: 35_000_00 },
        { account: { currency: 'USD' }, amountMinor: 1_200_00 },
      ],
      HOME,
      RATE,
    );
    // 35,000 + (1,200 x 300 = 360,000) = 395,000
    expect(totalMinor).toBe(39_500_000);
    expect(excluded).toBe(0);
  });

  it('EXCLUDES an unconvertible account from the figure, not just the label', () => {
    /*
     * The bug this replaced a hand-rolled reduce for: `toHomeMinor` returns an
     * unconvertible amount unchanged, so summing its result added EUR 500 into
     * a rupee total as 500 — while the header said that account was excluded.
     * The number and the words disagreed.
     */
    const { totalMinor, excluded } = sumInHome(
      [
        { account: { currency: null }, amountMinor: 100_00 },
        { account: { currency: 'EUR' }, amountMinor: 500_00 },
      ],
      HOME,
      RATE,
    );
    expect(totalMinor).toBe(100_00);
    expect(excluded).toBe(1);
  });

  it('totals the real five-account board correctly', () => {
    const { totalMinor, excluded } = sumInHome(
      [
        { account: { currency: null }, amountMinor: 350_000_00 },
        { account: { currency: 'USD' }, amountMinor: 1_200_00 },
        { account: { currency: null }, amountMinor: 120_000_00 },
        { account: { currency: 'USD' }, amountMinor: 800_00 },
        { account: { currency: 'EUR' }, amountMinor: 500_00 },
      ],
      HOME,
      RATE,
    );
    // 470,000 local + 2,000 USD x 300 = 600,000 -> 1,070,000. EUR left out.
    expect(totalMinor).toBe(107_000_000);
    expect(excluded).toBe(1);
  });

  it('is zero on an empty board', () => {
    expect(sumInHome([], HOME, RATE)).toEqual({ totalMinor: 0, excluded: 0 });
  });
});

/**
 * `fromHomeMinor` — the direction that says "put THIS much into that account".
 *
 * The real setup it exists for: a DFCC USD account that receives the salary and
 * a DFCC LKR account the bills are paid from. The board plans in rupees, so a
 * figure destined for the USD account has to be restated in dollars or it is
 * wrong by the exchange rate.
 */
describe('fromHomeMinor', () => {
  const usd = { currency: 'USD' };
  const lkr = { currency: 'LKR' };
  const legacy = { currency: null };

  it('converts a home amount into a foreign account’s own currency', () => {
    // LKR 578,214.00 at 323.25 is USD 1,788.75
    expect(fromHomeMinor(57_821_400, usd, 'LKR', 323.25)).toBe(178_875);
  });

  it('leaves a home-currency account untouched', () => {
    expect(fromHomeMinor(57_821_400, lkr, 'LKR', 323.25)).toBe(57_821_400);
  });

  /** A null currency is a pre-migration row, which means the home currency. */
  it('leaves a legacy null-currency account untouched', () => {
    expect(fromHomeMinor(1_000, legacy, 'LKR', 323.25)).toBe(1_000);
  });

  /**
   * The app stores exactly one rate. Inventing one for a third currency would
   * produce a confidently wrong figure, which is worse than an unconverted one
   * the UI can flag — see `needsRate`.
   */
  it('passes a currency it has no rate for through unconverted', () => {
    expect(fromHomeMinor(1_000, { currency: 'GBP' }, 'LKR', 323.25)).toBe(1_000);
  });

  it('passes through rather than dividing by an unusable rate', () => {
    expect(fromHomeMinor(1_000, usd, 'LKR', 0)).toBe(1_000);
    expect(fromHomeMinor(1_000, usd, 'LKR', Number.NaN)).toBe(1_000);
  });

  /** Round-trips within a cent, so the two directions cannot drift apart. */
  it('round-trips with toHomeMinor', () => {
    const home = 57_821_400;
    const back = toHomeMinor(fromHomeMinor(home, usd, 'LKR', 323.25), usd, 'LKR', 323.25);
    expect(Math.abs(back - home)).toBeLessThanOrEqual(100);
  });
});
