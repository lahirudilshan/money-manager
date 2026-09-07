import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFxFetchDue, parseFxPayload, refreshFxRates } from '../fxApi';
import { convertMinor } from '../rateTable';

/**
 * Reading a third-party FX feed without trusting it.
 *
 * The payload is not our schema and carries no SLA, so the parser's job is to
 * take only what it can verify and drop the rest — never to throw, and never to
 * let a malformed figure become a confidently wrong exchange rate.
 */

/** The shape open.er-api.com actually returns, trimmed. */
const PAYLOAD = {
  result: 'success',
  base_code: 'USD',
  rates: { USD: 1, LKR: 302.5, AUD: 1.52, EUR: 0.925 },
};

describe('parsing the feed', () => {
  it('INVERTS the quote, because the feed is per-USD and the table is in USD', () => {
    // "302.5 LKR per USD" means 1 LKR is 1/302.5 USD. Copying it straight
    // through would leave every converted figure wrong by the rate squared.
    const table = parseFxPayload(PAYLOAD);
    expect(table.LKR).toBeCloseTo(1 / 302.5, 12);
    expect(table.AUD).toBeCloseTo(1 / 1.52, 12);
  });

  it('produces rates that convert correctly end to end', () => {
    const table = parseFxPayload(PAYLOAD);
    // USD 100 -> LKR 30,250.
    expect(convertMinor(100_00, 'USD', 'LKR', table)).toBe(30_250_00);
    // The Australian case: EUR 100 -> AUD at 1.52/0.925.
    expect(convertMinor(100_00, 'EUR', 'AUD', table)).toBe(
      Math.round(100 * (1.52 / 0.925) * 100),
    );
  });

  it('omits the pivot itself, which is 1 by definition', () => {
    expect(parseFxPayload(PAYLOAD).USD).toBeUndefined();
  });

  it('drops unusable entries individually, keeping their neighbours', () => {
    const table = parseFxPayload({
      result: 'success',
      rates: { LKR: 302.5, EUR: 0, GBP: 'nope', AUD: 1.52, JPY: -3 },
    });
    expect(Object.keys(table).sort()).toEqual(['AUD', 'LKR']);
  });

  it('refuses a payload quoted against a different base', () => {
    // Inverting a EUR-based payload as though it were USD-based would produce
    // silently wrong numbers across every currency at once.
    expect(parseFxPayload({ result: 'success', base_code: 'EUR', rates: { USD: 1.08 } })).toEqual({});
  });

  it('refuses an explicit error payload', () => {
    expect(parseFxPayload({ result: 'error', rates: { LKR: 302.5 } })).toEqual({});
  });

  it('returns an empty table for anything unrecognisable, never throwing', () => {
    for (const junk of [null, undefined, 42, 'text', [], {}, { rates: null }, { rates: [] }]) {
      expect(parseFxPayload(junk)).toEqual({});
    }
  });
});

describe('refresh cadence', () => {
  const now = new Date('2026-09-07T12:00:00Z');

  it('fetches when nothing was ever stored', () => {
    expect(isFxFetchDue(null, now)).toBe(true);
    expect(isFxFetchDue(undefined, now)).toBe(true);
  });

  it('treats an unparseable stamp as never fetched', () => {
    expect(isFxFetchDue('not a date', now)).toBe(true);
  });

  it('holds off within the day and fetches after it', () => {
    expect(isFxFetchDue('2026-09-07T01:00:00Z', now)).toBe(false);
    expect(isFxFetchDue('2026-09-06T11:00:00Z', now)).toBe(true);
  });
});

describe('refreshFxRates', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A settings store standing in for the repository. */
  function store(seed: Record<string, string> = {}) {
    const data = { ...seed };
    return {
      data,
      get: (k: string) => data[k] ?? null,
      set: (k: string, v: string) => {
        data[k] = v;
      },
    };
  }

  const keys = { keyRates: 'rate_table', keyFetchedAt: 'rate_table_fetched_at' };

  it('does nothing when a fetch is not due', async () => {
    const s = store({ rate_table_fetched_at: new Date().toISOString() });
    const result = await refreshFxRates({ ...s, ...keys });
    expect(result).toBeNull();
    expect(s.data.rate_table).toBeUndefined();
  });

  it('keeps the previous table when the network fails', async () => {
    // Stubbed rather than left to hit the real network: an unstubbed test
    // passes or fails on whether this machine has internet, which is not the
    // behaviour under test.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const s = store({ rate_table: '{"LKR":0.0033}' });

    const result = await refreshFxRates({ ...s, ...keys });

    expect(result).toBeNull();
    expect(s.data.rate_table).toBe('{"LKR":0.0033}');
  });

  it('MERGES over the stored table rather than replacing it', async () => {
    /*
     * A feed that briefly stops quoting a currency would otherwise silently
     * drop it, turning a working account into an unconvertible one. An older
     * rate beats no rate.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'success', base_code: 'USD', rates: { AUD: 1.52 } }),
      }),
    );
    const s = store({ rate_table: '{"LKR":0.0033}' });

    const result = await refreshFxRates({ ...s, ...keys });

    expect(result?.LKR).toBe(0.0033);
    expect(result?.AUD).toBeCloseTo(1 / 1.52, 12);
    expect(s.data.rate_table_fetched_at).toBeTruthy();
  });

  it('leaves the cache alone when the feed returns nothing usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 'error' }) }),
    );
    const s = store({ rate_table: '{"LKR":0.0033}' });

    expect(await refreshFxRates({ ...s, ...keys })).toBeNull();
    expect(s.data.rate_table).toBe('{"LKR":0.0033}');
  });
});
