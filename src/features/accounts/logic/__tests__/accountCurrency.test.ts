import { describe, expect, it } from 'vitest';
import {
  accountCurrency,
  fromHomeMinor,
  isForeignAccount,
  needsRate,
  sumInHome,
  toHomeMinor,
} from '../accountCurrency';
import type { RateTable } from '~/features/rates/logic/rateTable';

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
  /** 1 LKR = 1/300 USD, i.e. the old `usd_rate` of 300 expressed as a table. */
  const RATE: RateTable = { LKR: 1 / 300 };

  it('leaves a home-currency amount untouched', () => {
    expect(toHomeMinor(500_000, { currency: 'LKR' }, 'LKR', RATE)).toBe(500_000);
    expect(toHomeMinor(500_000, {}, 'LKR', RATE)).toBe(500_000);
  });

  it('converts USD into the home currency', () => {
    // USD 1,200 at 300 = LKR 360,000. Unchanged from the single-rate era.
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'LKR', RATE)).toBe(36_000_000);
  });

  it('now converts a THIRD currency, given its rate', () => {
    /*
     * This is the behaviour change. It used to be impossible: with one scalar
     * rate the app could only ever do USD, so a EUR balance was returned
     * unconverted. With EUR in the table the pair resolves through the pivot.
     */
    const table: RateTable = { LKR: 1 / 300, EUR: 1.08 };
    // EUR 1,000 -> USD 1,080 -> LKR 324,000.
    expect(toHomeMinor(100_000, { currency: 'EUR' }, 'LKR', table)).toBe(32_400_000);
  });

  it('still does NOT convert a currency with no rate', () => {
    /*
     * The refusal survives the generalisation. Inventing a rate would produce a
     * confident wrong number — worse than leaving the figure alone, because
     * nothing on screen would reveal the guess.
     */
    expect(toHomeMinor(100_000, { currency: 'EUR' }, 'LKR', RATE)).toBe(100_000);
  });

  it('refuses a nonsense rate rather than zeroing the amount', () => {
    // A rate of 0 would silently wipe a real balance to nothing.
    for (const bad of [0, -5, Number.NaN]) {
      expect(toHomeMinor(120_000, { currency: 'USD' }, 'LKR', { LKR: bad })).toBe(120_000);
    }
  });

  it('works when the home currency IS usd', () => {
    // Someone whose app currency is USD holding a USD account: no conversion.
    expect(toHomeMinor(120_000, { currency: 'USD' }, 'USD', RATE)).toBe(120_000);
  });

  it('converts for a home currency that is neither LKR nor USD', () => {
    // The Australian case: AUD home, EUR account, no USD anywhere on screen.
    const table: RateTable = { AUD: 0.66, EUR: 1.08 };
    const result = toHomeMinor(500_00, { currency: 'EUR' }, 'AUD', table);
    expect(result).toBe(Math.round(500 * (1.08 / 0.66) * 100));
  });
});

describe('needsRate', () => {
  it('flags only a foreign currency with no stored rate', () => {
    const table: RateTable = { LKR: 1 / 300 };
    expect(needsRate({ currency: 'EUR' }, 'LKR', table)).toBe(true);
    expect(needsRate({ currency: 'USD' }, 'LKR', table)).toBe(false);
    expect(needsRate({ currency: 'LKR' }, 'LKR', table)).toBe(false);
    expect(needsRate({}, 'LKR', table)).toBe(false);
  });

  it('stops flagging a currency once its rate arrives', () => {
    expect(needsRate({ currency: 'EUR' }, 'LKR', { LKR: 1 / 300 })).toBe(true);
    expect(needsRate({ currency: 'EUR' }, 'LKR', { LKR: 1 / 300, EUR: 1.08 })).toBe(false);
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
    const table: RateTable = { LKR: 1 / 300 };
    const total =
      toHomeMinor(35_000_00, lkrSide, 'LKR', table) + toHomeMinor(1_200_00, usdSide, 'LKR', table);
    expect(total).toBe(35_000_00 + 36_000_000);
  });
});

describe('sumInHome', () => {
  const HOME = 'LKR';
  /** USD convertible, EUR deliberately absent — the "excluded" cases below. */
  const RATE: RateTable = { LKR: 1 / 300 };

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
  /** LKR at 323.25 per USD, as a table. GBP deliberately absent. */
  const RATE: RateTable = { LKR: 1 / 323.25 };

  it('converts a home amount into a foreign account’s own currency', () => {
    // LKR 578,214.00 at 323.25 is USD 1,788.75
    expect(fromHomeMinor(57_821_400, usd, 'LKR', RATE)).toBe(178_875);
  });

  it('leaves a home-currency account untouched', () => {
    expect(fromHomeMinor(57_821_400, lkr, 'LKR', RATE)).toBe(57_821_400);
  });

  /** A null currency is a pre-migration row, which means the home currency. */
  it('leaves a legacy null-currency account untouched', () => {
    expect(fromHomeMinor(1_000, legacy, 'LKR', RATE)).toBe(1_000);
  });

  /**
   * Inventing a rate for a currency the app has none for would produce a
   * confidently wrong figure, which is worse than an unconverted one the UI can
   * flag — see `needsRate`. Unchanged by the move to a rate table.
   */
  it('passes a currency it has no rate for through unconverted', () => {
    expect(fromHomeMinor(1_000, { currency: 'GBP' }, 'LKR', RATE)).toBe(1_000);
  });

  it('converts that same currency once its rate is present', () => {
    // The generalisation: GBP is only unconvertible until a rate arrives.
    const withGbp: RateTable = { LKR: 1 / 323.25, GBP: 1.27 };
    expect(fromHomeMinor(1_000, { currency: 'GBP' }, 'LKR', withGbp)).not.toBe(1_000);
  });

  it('passes through rather than dividing by an unusable rate', () => {
    expect(fromHomeMinor(1_000, usd, 'LKR', { LKR: 0 })).toBe(1_000);
    expect(fromHomeMinor(1_000, usd, 'LKR', { LKR: Number.NaN })).toBe(1_000);
  });

  /** Round-trips within a cent, so the two directions cannot drift apart. */
  it('round-trips with toHomeMinor', () => {
    const home = 57_821_400;
    const back = toHomeMinor(fromHomeMinor(home, usd, 'LKR', RATE), usd, 'LKR', RATE);
    expect(Math.abs(back - home)).toBeLessThanOrEqual(100);
  });
});
