import { describe, expect, it } from 'vitest';
import { BANKS } from '../../data/banks';

/**
 * Filtering the bank list.
 *
 * The list is twenty brands, which is long enough that scrolling to find one is
 * slower than typing three letters. The filter matches the SHORT name as well
 * as the full one because that is what people actually type — "BOC", "HNB",
 * "NTB" — and a filter that only knew "Bank of Ceylon" would come back empty for
 * the most natural query anyone could make.
 */

/** The predicate `BankList` applies, in pure form. */
function search(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return BANKS;
  return BANKS.filter(
    (brand) => brand.name.toLowerCase().includes(q) || brand.shortName.toLowerCase().includes(q),
  );
}

const names = (query: string) => search(query).map((brand) => brand.name);

describe('bank search', () => {
  /** The reason short names are indexed at all. */
  it('finds a bank by its abbreviation', () => {
    expect(names('boc')).toEqual(['Bank of Ceylon']);
    expect(names('hnb')).toEqual(['Hatton National Bank']);
  });

  it('finds a bank by part of its full name', () => {
    expect(names('sampath')).toEqual(['Sampath Bank']);
  });

  /** A broad query legitimately returns several. */
  it('returns every bank matching a shared phrase', () => {
    expect(names('bank of')).toEqual(['Bank of Ceylon', 'Commercial Bank of Ceylon']);
  });

  it('is case-insensitive', () => {
    expect(names('BOC')).toEqual(names('boc'));
  });

  /** Trailing whitespace from a keyboard must not defeat the match. */
  it('ignores surrounding whitespace', () => {
    expect(names('  boc  ')).toEqual(['Bank of Ceylon']);
  });

  /** An empty query is not a filter — it shows everything. */
  it('returns the full list for an empty query', () => {
    expect(search('')).toHaveLength(BANKS.length);
    expect(search('   ')).toHaveLength(BANKS.length);
  });

  /** No match returns nothing, so the UI can offer its own message. */
  it('returns nothing when no bank matches', () => {
    expect(search('zzzz')).toHaveLength(0);
  });

  /**
   * Every bank must be reachable by BOTH of its names.
   *
   * A blanket check rather than a handful of examples, so adding a brand to the
   * catalog cannot quietly introduce one that search cannot find.
   */
  it('finds every bank by its full name and by its short name', () => {
    for (const brand of BANKS) {
      expect(search(brand.name)).toContainEqual(brand);
      expect(search(brand.shortName)).toContainEqual(brand);
    }
  });
});

/**
 * The short name is shown under the full one, but only when it differs.
 *
 * Several catalog entries are their own abbreviation ("FriMi", "eZ Cash"), and
 * printing the same string twice reads as a rendering fault rather than as
 * extra information.
 */
describe('short name display', () => {
  const differs = (brand: (typeof BANKS)[number]) =>
    brand.shortName.toLowerCase() !== brand.name.toLowerCase();

  it('shows a genuine abbreviation', () => {
    const hnb = BANKS.find((b) => b.id === 'hnb')!;

    expect(differs(hnb)).toBe(true);
  });

  it('hides one that merely repeats the full name', () => {
    const same = BANKS.filter((b) => b.name.toLowerCase() === b.shortName.toLowerCase());

    expect(same.length).toBeGreaterThan(0);
    for (const brand of same) expect(differs(brand)).toBe(false);
  });
});
