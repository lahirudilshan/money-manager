import { describe, expect, it } from 'vitest';
import { suggestCategoryIcon } from '../categoryIcons';

describe('suggestCategoryIcon', () => {
  it('returns null for empty or punctuation-only names', () => {
    expect(suggestCategoryIcon('')).toBeNull();
    expect(suggestCategoryIcon('   ')).toBeNull();
    expect(suggestCategoryIcon('!!!')).toBeNull();
  });

  it('maps common daily-living names to sensible icons', () => {
    expect(suggestCategoryIcon('Groceries')).toBe('basket-outline');
    expect(suggestCategoryIcon('Home rent')).toBe('home-outline');
    expect(suggestCategoryIcon('Electricity bill')).toBe('flash-outline');
    expect(suggestCategoryIcon('Water')).toBe('water-outline');
    expect(suggestCategoryIcon('Vehicle lease')).toBeTruthy();
    expect(suggestCategoryIcon('Netflix')).toBe('tv-outline');
    expect(suggestCategoryIcon('Internet')).toBe('wifi-outline');
    expect(suggestCategoryIcon('Health insurance')).toBeTruthy();
    expect(suggestCategoryIcon('Kids school')).toBeTruthy();
  });

  it('marks general debt with its own icon, not a card', () => {
    /*
     * A card is one PRODUCT among several kinds of debt — leases, EMIs,
     * pawning — so it cannot stand for the group, and it already belongs to
     * the Credit card line inside it.
     */
    expect(suggestCategoryIcon('Personal loan')).toBe('cash-outline');
    expect(suggestCategoryIcon('EMI')).toBe('cash-outline');
  });

  it('still gives an actual card the card icon', () => {
    // "Credit card" contains "credit", so the card entry has to win the match
    // ahead of the general debt one.
    expect(suggestCategoryIcon('Credit card')).toBe('card-outline');
    expect(suggestCategoryIcon('Visa payment')).toBe('card-outline');
  });

  it('matches on any word in a multi-word name', () => {
    expect(suggestCategoryIcon('Monthly groceries and market')).toBe('basket-outline');
    expect(suggestCategoryIcon('My mobile reload')).toBe('call-outline');
  });

  it('matches prefixes so partial typing still resolves', () => {
    // "groc" → grocery
    expect(suggestCategoryIcon('groc')).toBe('basket-outline');
    // "electri" → electricity
    expect(suggestCategoryIcon('electri')).toBe('flash-outline');
  });

  it('ignores short noise words that should not trigger a match', () => {
    expect(suggestCategoryIcon('to a')).toBeNull();
    expect(suggestCategoryIcon('xyz')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(suggestCategoryIcon('GROCERIES')).toBe('basket-outline');
    expect(suggestCategoryIcon('gRoCeRy')).toBe('basket-outline');
  });
});
