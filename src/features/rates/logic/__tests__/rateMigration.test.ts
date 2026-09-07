import { describe, expect, it } from 'vitest';
import { convertMinor, parseRateTable, withLegacyUsdRate } from '../rateTable';
import { toHomeMinor, fromHomeMinor, sumInHome } from '~/features/accounts/logic/accountCurrency';

/**
 * The upgrade path for a board that already exists.
 *
 * A user on the old build has a `usd_rate` scalar and no rate table. After the
 * upgrade every figure they already know must read EXACTLY the same — not
 * approximately. A silent shift here would look like the app losing their
 * money, and it is the single most dangerous part of this change.
 */

/** What a real Sri Lankan board holds today. */
const LEGACY_USD_RATE = 323.25;
const HOME = 'LKR';

/** The table the store builds on first launch after the upgrade. */
const migrated = withLegacyUsdRate(parseRateTable(null), HOME, LEGACY_USD_RATE);

describe('upgrading from the single usd_rate scalar', () => {
  it('reproduces the old USD -> home conversion exactly', () => {
    // Old code: Math.round(toMajor(minor) * rate * 100) for USD accounts.
    const usd = 1_788_75;
    const expected = Math.round((usd / 100) * LEGACY_USD_RATE * 100);
    expect(toHomeMinor(usd, { currency: 'USD' }, HOME, migrated)).toBe(expected);
  });

  it('reproduces the old home -> USD conversion exactly', () => {
    // Old code: Math.round(amountMinor / rate).
    const home = 57_821_400;
    expect(fromHomeMinor(home, { currency: 'USD' }, HOME, migrated)).toBe(
      Math.round(home / LEGACY_USD_RATE),
    );
  });

  it('keeps a mixed board total unchanged', () => {
    const { totalMinor, excluded } = sumInHome(
      [
        { account: { currency: null }, amountMinor: 350_000_00 },
        { account: { currency: 'USD' }, amountMinor: 1_200_00 },
        { account: { currency: null }, amountMinor: 120_000_00 },
      ],
      HOME,
      migrated,
    );
    const usdInHome = Math.round(1_200 * LEGACY_USD_RATE * 100);
    expect(totalMinor).toBe(350_000_00 + 120_000_00 + usdInHome);
    expect(excluded).toBe(0);
  });

  it('still excludes a currency the old build could not convert either', () => {
    // No behaviour regression: EUR was excluded before and stays excluded until
    // a rate for it actually arrives.
    const { excluded } = sumInHome(
      [{ account: { currency: 'EUR' }, amountMinor: 500_00 }],
      HOME,
      migrated,
    );
    expect(excluded).toBe(1);
  });

  it('survives a corrupt stored table without losing the legacy rate', () => {
    // Hydration must not throw, and must still convert USD.
    for (const junk of ['', 'not json', '[]', 'null', '{"LKR":"abc"}']) {
      const table = withLegacyUsdRate(parseRateTable(junk), HOME, LEGACY_USD_RATE);
      expect(convertMinor(100_00, 'USD', HOME, table)).toBe(
        Math.round(100 * LEGACY_USD_RATE * 100),
      );
    }
  });

  it('lets a fetched rate override the reconstructed one', () => {
    const fetched = withLegacyUsdRate(parseRateTable('{"LKR":0.0031}'), HOME, LEGACY_USD_RATE);
    expect(fetched.LKR).toBe(0.0031);
  });
});
