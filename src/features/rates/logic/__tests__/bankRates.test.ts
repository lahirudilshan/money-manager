import { describe, expect, it } from 'vitest';
import { BANKS } from '~/shared/data/banks';
import {
  gapToBest,
  matchBankId,
  rateForBank,
  resolveBankRates,
  sortByBuying,
  usdNeededFor,
  resolveUsdRate,
  roundRate,
  type BankRate,
} from '../bankRates';
import { isBankFetchDue, parseRates, readCachedRates } from '../bankRatesApi';

const rate = (bankName: string, ttBuying: number | null): BankRate => ({
  bankName,
  ttBuying,
  ttSelling: null,
  at: '2026-09-02T04:30:00.000Z',
});

describe('matchBankId', () => {
  it('maps a source name to the app bank id', () => {
    expect(matchBankId('Commercial Bank')).toBe('commercial');
    expect(matchBankId('Bank of Ceylon')).toBe('boc');
  });

  it('tolerates case, padding and collapsed whitespace', () => {
    expect(matchBankId('  HATTON   NATIONAL BANK ')).toBe('hnb');
  });

  it("matches People's Bank with and without the apostrophe", () => {
    expect(matchBankId("People's Bank")).toBe('peoples');
    expect(matchBankId('Peoples Bank')).toBe('peoples');
  });

  it('returns null for a source bank the app has no entry for', () => {
    expect(matchBankId('Wise')).toBeNull();
  });

  /**
   * The mapping is the part that silently rots: the source owns the spelling,
   * so a rename shows up as a bank with no rate rather than as an error. This
   * asserts every id the table claims actually exists in the catalog.
   */
  it('only maps to bank ids that exist in the catalog', () => {
    const known = new Set(BANKS.map((bank) => bank.id));
    const names = [
      'Amana Bank', 'Bank of Ceylon', 'Cargills Bank', 'Commercial Bank', 'DFCC Bank',
      'Hatton National Bank', 'National Development Bank', 'National Savings Bank',
      'Nations Trust Bank', "People's Bank", 'Sampath Bank', 'Seylan Bank',
      'Standard Chartered Bank', 'Union Bank', 'Pan Asia Bank', 'HSBC',
    ];
    for (const name of names) {
      const id = matchBankId(name);
      expect(id, `${name} should map`).not.toBeNull();
      expect(known, `${name} -> ${id}`).toContain(id!);
    }
  });
});

describe('resolveBankRates', () => {
  /**
   * An unmatched row cannot carry a logo, be joined to a card, or ever be the
   * highlighted "yours" — it would render as a grey placeholder among real
   * brands, which reads as a fault rather than a choice.
   */
  it('drops a bank the catalog has no entry for', () => {
    const resolved = resolveBankRates([rate('Wise', 327.65), rate('DFCC Bank', 323.25)]);
    expect(resolved.map((r) => r.bankName)).toEqual(['DFCC Bank']);
  });

  it('keeps every bank it can match, with its id attached', () => {
    const resolved = resolveBankRates([rate('Commercial Bank', 324), rate('Seylan Bank', 324.4)]);
    expect(resolved.map((r) => r.bankId)).toEqual(['commercial', 'seylan']);
  });
});

describe('sortByBuying', () => {
  it('puts the best-paying bank first', () => {
    const sorted = sortByBuying(
      resolveBankRates([rate('Nations Trust Bank', 322.8), rate('Standard Chartered Bank', 329.5)]),
    );
    expect(sorted[0].bankName).toBe('Standard Chartered Bank');
  });

  it('sorts a bank with no TT rate last, not as zero', () => {
    const sorted = sortByBuying(
      resolveBankRates([rate('Cargills Bank', null), rate('Union Bank', 324)]),
    );
    expect(sorted[0].bankName).toBe('Union Bank');
    expect(sorted[1].bankName).toBe('Cargills Bank');
  });
});

describe('rateForBank', () => {
  const rates = resolveBankRates([rate('Commercial Bank', 324), rate('Cargills Bank', null)]);

  it('finds the row for a bank id', () => {
    expect(rateForBank(rates, 'commercial')?.ttBuying).toBe(324);
  });

  it('returns null for a bank that published no TT rate', () => {
    expect(rateForBank(rates, 'cargills')).toBeNull();
  });

  it('returns null when no bank is set', () => {
    expect(rateForBank(rates, null)).toBeNull();
  });
});

describe('usdNeededFor', () => {
  it('divides the home total by the rate, to the next whole dollar', () => {
    // LKR 578,214.00 at 323.25 is USD 1,788.75… -> $1,789
    expect(usdNeededFor(57_821_400, 323.25)).toBe(178_900);
  });

  /**
   * Rounding UP matters: the exact quotient lands a hair short once the bank
   * does its own rounding, and being short on the rent is worse than sending
   * a little extra.
   */
  it('rounds up rather than down', () => {
    expect(usdNeededFor(1_000, 3)).toBe(400);
  });

  /**
   * WHOLE dollars, not cents. This figure gets retyped into a transfer form,
   * and nobody wires $1,788.76 — the cents were precision the rate itself does
   * not have.
   */
  it('always lands on a whole dollar', () => {
    for (const [minor, rate] of [[57_821_400, 323.25], [1, 300], [999_999, 327.82]] as const) {
      expect(usdNeededFor(minor, rate)! % 100).toBe(0);
    }
  });

  it('rounds an exact dollar up to nothing more', () => {
    // 300 LKR at 300 is exactly $1 — it must not become $2.
    expect(usdNeededFor(30_000, 300)).toBe(100);
  });

  it('is zero for a total already covered', () => {
    expect(usdNeededFor(0, 324)).toBe(0);
  });

  it('returns null without a usable rate', () => {
    expect(usdNeededFor(57_821_400, 0)).toBeNull();
    expect(usdNeededFor(57_821_400, Number.NaN)).toBeNull();
  });
});

describe('gapToBest', () => {
  const rates = resolveBankRates([
    rate('Standard Chartered Bank', 329.5),
    rate('Nations Trust Bank', 322.8),
  ]);

  it('reports how far a bank sits below the best', () => {
    expect(gapToBest(rates, 'nations-trust')?.gap).toBe(6.7);
  });

  it('reports nothing when the user is already on the best rate', () => {
    expect(gapToBest(rates, 'standard-chartered')).toBeNull();
  });
});

describe('parseRates', () => {
  /** A captured row, in the exact shape the live API returned. */
  const live = [
    { bank_name: 'Amana Bank', cur_selling: 331.65, currency: 'USD', tt_buying: 325.65, tt_selling: 330.65, timestamp: 1788323434000.0 },
    { tt_selling: 332.6, timestamp: 1788323481000.0, dd_buying: 323.2, tt_buying: 323.6, bank_name: 'Bank of Ceylon', currency: 'USD' },
  ];

  it('reads the live payload shape', () => {
    const parsed = parseRates(live);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ bankName: 'Amana Bank', ttBuying: 325.65, ttSelling: 330.65 });
    expect(parsed[0].at).toBe(new Date(1788323434000).toISOString());
  });

  it('keeps a bank that publishes no TT buying rate', () => {
    const parsed = parseRates([{ bank_name: 'Cargills Bank', timestamp: 1788323434000 }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ttBuying).toBeNull();
  });

  it('drops a row with no bank name, which cannot be labelled or matched', () => {
    expect(parseRates([{ tt_buying: 324 }])).toHaveLength(0);
  });

  it('rejects a non-numeric or non-positive rate rather than trusting it', () => {
    const parsed = parseRates([{ bank_name: 'X', tt_buying: '324', tt_selling: -1 }]);
    expect(parsed[0].ttBuying).toBeNull();
    expect(parsed[0].ttSelling).toBeNull();
  });

  it('survives anything that is not an array', () => {
    expect(parseRates(null)).toEqual([]);
    expect(parseRates({ error: 'nope' })).toEqual([]);
    expect(parseRates('')).toEqual([]);
  });
});

describe('isBankFetchDue', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');

  it('is due when nothing was ever fetched', () => {
    expect(isBankFetchDue(null, now)).toBe(true);
    expect(isBankFetchDue(undefined, now)).toBe(true);
  });

  it('is due when the stamp is unreadable, rather than blocking forever', () => {
    expect(isBankFetchDue('not-a-date', now)).toBe(true);
  });

  it('is not due within the same day', () => {
    expect(isBankFetchDue('2026-09-02T06:00:00.000Z', now)).toBe(false);
  });

  it('is due once a full day has passed', () => {
    expect(isBankFetchDue('2026-09-01T11:59:00.000Z', now)).toBe(true);
  });
});

describe('readCachedRates', () => {
  it('reads back what the cache wrote', () => {
    const rows = [{ bankName: 'DFCC Bank', ttBuying: 323.25, ttSelling: null, at: 'x' }];
    expect(readCachedRates(JSON.stringify(rows))).toEqual(rows);
  });

  it('survives an empty, absent or corrupt cache', () => {
    expect(readCachedRates(null)).toEqual([]);
    expect(readCachedRates('')).toEqual([]);
    expect(readCachedRates('{oh no')).toEqual([]);
    expect(readCachedRates('{"not":"an array"}')).toEqual([]);
  });
});

describe('resolveUsdRate', () => {
  it("uses today's bank rate when there is one", () => {
    expect(resolveUsdRate({ bankRate: 323.25, lastKnown: 300 })).toBe(323.25);
  });

  /**
   * The offline case, which is normal on a phone. Yesterday's figure is far
   * closer to the truth than any hardcoded default.
   */
  it('falls back to the last known rate when the fetch found nothing', () => {
    expect(resolveUsdRate({ bankRate: null, lastKnown: 322.8 })).toBe(322.8);
  });

  it('is null when there is nothing at all to go on', () => {
    expect(resolveUsdRate({ bankRate: null, lastKnown: null })).toBeNull();
    expect(resolveUsdRate({ bankRate: undefined, lastKnown: undefined })).toBeNull();
  });

  it('rejects a zero or negative rate rather than adopting it', () => {
    expect(resolveUsdRate({ bankRate: 0, lastKnown: 320 })).toBe(320);
    expect(resolveUsdRate({ bankRate: -5, lastKnown: null })).toBeNull();
  });

  /** A source quotes People's Bank to four decimals; banks publish two. */
  it('rounds to the two decimals banks actually publish', () => {
    expect(resolveUsdRate({ bankRate: 324.3372, lastKnown: null })).toBe(324.34);
  });
});

describe('roundRate', () => {
  it('rounds to two decimals', () => {
    expect(roundRate(324.3372)).toBe(324.34);
    expect(roundRate(323.25)).toBe(323.25);
  });
});
