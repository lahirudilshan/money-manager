import { describe, expect, it } from 'vitest';

/**
 * What a confirmed SMS draft is NAMED.
 *
 * The bank names a merchant at best, and often nothing at all — a plain
 * transfer arrives with none — so the entry was written as the literally
 * useless "SMS transaction" and the user had no way to say what it was. Manual
 * entry has always asked "What was it?"; the confirm path now does too.
 *
 * The rule under test is the fallback chain in `confirmDraft`:
 *   the user's words, else the bank's merchant, else a last-resort label.
 */

/** Exactly the expression `confirmDraft` uses at both write sites. */
const resolveName = (typed: string | undefined, merchant: string) =>
  typed?.trim() || merchant || 'SMS transaction';

describe('naming a confirmed payment', () => {
  it('uses what the user typed', () => {
    expect(resolveName('Keells run', 'KEELLS SUPER')).toBe('Keells run');
  });

  it('falls back to the merchant when the user typed nothing', () => {
    // The common case: the merchant is right and the field is left as seeded.
    expect(resolveName('', 'KEELLS SUPER')).toBe('KEELLS SUPER');
    expect(resolveName(undefined, 'KEELLS SUPER')).toBe('KEELLS SUPER');
  });

  it('treats whitespace as nothing typed', () => {
    // Otherwise a stray space would save an entry with a blank name.
    expect(resolveName('   ', 'KEELLS SUPER')).toBe('KEELLS SUPER');
  });

  it('trims what it does keep', () => {
    expect(resolveName('  Keells run  ', 'KEELLS SUPER')).toBe('Keells run');
  });

  it('lets the user name a message that carries NO merchant', () => {
    // The case the field exists for: this used to be unavoidable.
    expect(resolveName('Rent to landlord', '')).toBe('Rent to landlord');
  });

  it('still has a last resort when there is neither', () => {
    expect(resolveName('', '')).toBe('SMS transaction');
    expect(resolveName(undefined, '')).toBe('SMS transaction');
  });
});
