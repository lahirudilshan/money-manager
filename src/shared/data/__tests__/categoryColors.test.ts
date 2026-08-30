import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  suggestCategoryColor,
} from '~/shared/data/categoryColors';

describe('CATEGORY_COLORS', () => {
  it('has no duplicate values', () => {
    const values = CATEGORY_COLORS.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('is all uppercase 6-digit hex', () => {
    for (const colour of CATEGORY_COLORS) {
      expect(colour.value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  // The default has to be selectable, or the picker opens with nothing marked.
  it('includes the default colour', () => {
    expect(CATEGORY_COLORS.some((c) => c.value === DEFAULT_CATEGORY_COLOR)).toBe(true);
  });
});

describe('suggestCategoryColor', () => {
  it('returns null for an empty or wordless name', () => {
    expect(suggestCategoryColor('')).toBeNull();
    expect(suggestCategoryColor('   ')).toBeNull();
    expect(suggestCategoryColor('!!!')).toBeNull();
  });

  it('matches an exact word', () => {
    expect(suggestCategoryColor('Groceries')).toBe('#65A30D');
    expect(suggestCategoryColor('Water')).toBe('#0891B2');
    expect(suggestCategoryColor('Rent')).toBe('#4F46E5');
  });

  it('matches inside a longer name', () => {
    expect(suggestCategoryColor('Monthly water bill')).toBe('#0891B2');
    expect(suggestCategoryColor('Vet and pet supplies')).toBe('#059669');
  });

  // Longer keyword wins a tie, so a name carrying two associations resolves to
  // the more specific one rather than to whichever entry is listed first.
  it('prefers the more specific keyword when a name matches two', () => {
    // "Pet food" is both 'pet' (emerald) and 'food' (orange); 'food' is longer.
    expect(suggestCategoryColor('Pet food')).toBe('#EA580C');
  });

  it('is case-insensitive', () => {
    expect(suggestCategoryColor('GROCERIES')).toBe(suggestCategoryColor('groceries'));
  });

  it('matches a prefix in either direction', () => {
    expect(suggestCategoryColor('Electric')).toBe('#D97706');
    expect(suggestCategoryColor('Electricity')).toBe('#D97706');
  });

  // A name with nothing to go on keeps whatever the user or the default chose,
  // rather than being assigned a colour at random.
  it('returns null when nothing matches', () => {
    expect(suggestCategoryColor('Zzzyqx')).toBeNull();
  });

  it('always returns a colour that is in the set', () => {
    const names = ['Groceries', 'Loans', 'Netflix', 'School fees', 'Insurance'];
    for (const name of names) {
      const suggested = suggestCategoryColor(name);
      expect(suggested).not.toBeNull();
      expect(CATEGORY_COLORS.some((c) => c.value === suggested)).toBe(true);
    }
  });
});
