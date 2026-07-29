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
