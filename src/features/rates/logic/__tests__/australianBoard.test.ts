import { describe, expect, it } from 'vitest';
import { defaultCurrencyForRegion } from '../currencies';
import { parseFxPayload } from '../fxApi';
import { convertMinor, missingRates } from '../rateTable';
import {
  accountCurrency,
  isForeignAccount,
  needsRate,
  sumInHome,
  toHomeMinor,
} from '~/features/accounts/logic/accountCurrency';

/**
 * The whole point of the multi-currency work, end to end: an Australian board.
 *
 * Every step of the real path is exercised against the same data — region to
 * currency, feed to rate table, table to converted figures — because each piece
 * passing in isolation is what let the USD-only gap survive as long as it did.
 * Nothing here mentions USD, which is itself the assertion: the pivot must stay
 * invisible to a user who never holds dollars.
 */

/** Trimmed from what open.er-api.com actually returned on 2026-09-07. */
const FEED = {
  result: 'success',
  base_code: 'USD',
  rates: { USD: 1, AUD: 1.3877, EUR: 0.8611, GBP: 0.7397, LKR: 327.87 },
};

const rates = parseFxPayload(FEED);
const HOME = 'AUD';

describe('an Australian user, from launch to a converted figure', () => {
  it('picks AUD from the device region', () => {
    expect(defaultCurrencyForRegion('en-AU')).toBe('AUD');
  });

  it('treats an AUD account as home and a EUR one as foreign', () => {
    expect(isForeignAccount({ currency: 'AUD' }, HOME)).toBe(false);
    expect(isForeignAccount({ currency: 'EUR' }, HOME)).toBe(true);
    // A row predating the currency column means home money, not dollars.
    expect(accountCurrency({ currency: null }, HOME)).toBe('AUD');
  });

  it('converts a EUR balance into AUD — the case that was broken', () => {
    /*
     * Before the rate table this returned 50_000 unchanged: EUR 500 landed in
     * an AUD total as though it were AUD 500, understating it by ~38%.
     */
    const converted = toHomeMinor(500_00, { currency: 'EUR' }, HOME, rates);
    expect(converted).toBe(Math.round(500 * (1.3877 / 0.8611) * 100));
    expect(converted).not.toBe(500_00);
  });

  it('totals a mixed AUD/EUR/GBP board with nothing excluded', () => {
    const { totalMinor, excluded } = sumInHome(
      [
        { account: { currency: null }, amountMinor: 4_200_00 },
        { account: { currency: 'EUR' }, amountMinor: 500_00 },
        { account: { currency: 'GBP' }, amountMinor: 300_00 },
      ],
      HOME,
      rates,
    );

    const eur = Math.round(500 * (1.3877 / 0.8611) * 100);
    const gbp = Math.round(300 * (1.3877 / 0.7397) * 100);
    expect(totalMinor).toBe(4_200_00 + eur + gbp);
    expect(excluded).toBe(0);
  });

  it('still refuses a currency the feed did not quote', () => {
    // The honesty guarantee survives: no rate means excluded and named, never
    // folded in at face value.
    expect(needsRate({ currency: 'NOK' }, HOME, rates)).toBe(true);
    expect(missingRates(rates, HOME, ['EUR', 'NOK'])).toEqual(['NOK']);

    const { totalMinor, excluded } = sumInHome(
      [{ account: { currency: 'NOK' }, amountMinor: 900_00 }],
      HOME,
      rates,
    );
    expect(totalMinor).toBe(0);
    expect(excluded).toBe(1);
  });

  it('needs no rate at all for a board holding only its own currency', () => {
    // First launch, offline: an AUD-only board must be fully correct with an
    // empty table rather than showing everything as unconvertible.
    expect(needsRate({ currency: 'AUD' }, HOME, {})).toBe(false);
    expect(convertMinor(1_000_00, 'AUD', 'AUD', {})).toBe(1_000_00);
  });

  it('keeps a Sri Lankan board working from the same table', () => {
    // The AU support must not cost the existing users anything.
    expect(defaultCurrencyForRegion('si-LK')).toBe('LKR');
    expect(toHomeMinor(100_00, { currency: 'USD' }, 'LKR', rates)).toBe(
      Math.round(100 * 327.87 * 100),
    );
  });
});
