import { describe, expect, it } from 'vitest';
import { formatAmountInput, parseAmount, validateAmount } from '../money';

/**
 * Guards the money field's live formatting and its save-time validation.
 *
 * The hard requirement is that formatting runs on EVERY keystroke and must not
 * fight the person typing: half-finished input like "1." is a normal state, not
 * an error, and rewriting it would make a decimal impossible to enter.
 */

describe('formatAmountInput', () => {
  it('groups thousands as the number grows', () => {
    expect(formatAmountInput('1')).toBe('1');
    expect(formatAmountInput('123')).toBe('123');
    expect(formatAmountInput('1234')).toBe('1,234');
    expect(formatAmountInput('1234567')).toBe('1,234,567');
  });

  /*
   * The case that matters most. Stripping a trailing dot the instant it is
   * typed would make it impossible to reach the decimals at all.
   */
  it('keeps a half-typed decimal intact', () => {
    expect(formatAmountInput('1234.')).toBe('1,234.');
    expect(formatAmountInput('1234.5')).toBe('1,234.5');
    expect(formatAmountInput('1234.56')).toBe('1,234.56');
  });

  it('caps decimals at two, since minor units are cents', () => {
    // A third digit would be rounded away on save without the user seeing it.
    expect(formatAmountInput('1234.567')).toBe('1,234.56');
  });

  it('ignores a second decimal point rather than mangling the number', () => {
    expect(formatAmountInput('1.2.3')).toBe('1.23');
  });

  it('cleans a pasted amount that carries a currency and separators', () => {
    expect(formatAmountInput('LKR 1,250.75')).toBe('1,250.75');
    expect(formatAmountInput('Rs. 9 200')).toBe('9,200');
  });

  it('normalises leading zeros and a leading point', () => {
    expect(formatAmountInput('007')).toBe('7');
    expect(formatAmountInput('.5')).toBe('0.5');
    expect(formatAmountInput('0.5')).toBe('0.5');
  });

  it('survives empty and junk input without throwing', () => {
    expect(formatAmountInput('')).toBe('');
    expect(formatAmountInput('abc')).toBe('');
  });

  it('is idempotent, since its own output is fed back on the next keystroke', () => {
    const once = formatAmountInput('1234567.89');
    expect(formatAmountInput(once)).toBe(once);
  });

  it('round-trips through parseAmount to exact minor units', () => {
    // The formatted string is what gets saved, so its commas must not survive
    // into the stored figure.
    expect(parseAmount(formatAmountInput('1234.56'))).toBe(123456);
    expect(parseAmount(formatAmountInput('9,200'))).toBe(920000);
  });
});

describe('validateAmount', () => {
  it('accepts a well-formed amount', () => {
    expect(validateAmount('1,234.56')).toBeNull();
    expect(validateAmount('0.01')).toBeNull();
  });

  it('rejects empty, zero and negative amounts', () => {
    expect(validateAmount('')).toBe('Enter an amount');
    expect(validateAmount('0')).toBe('Amount must be more than zero');
    expect(validateAmount('0.00')).toBe('Amount must be more than zero');
    expect(validateAmount('-5')).toBe('Amount must be more than zero');
  });

  it('rejects an implausibly large figure', () => {
    expect(validateAmount('9999999999999999')).toBe('That amount is too large');
  });

  /*
   * "1." is fine to TYPE but incomplete to save; it parses as 1, which is a
   * real amount, so it validates. The formatter's job is to allow it on the way
   * in, and this records that the two functions disagree on purpose.
   */
  it('accepts a trailing dot, which parses as a whole number', () => {
    expect(validateAmount('1.')).toBeNull();
    expect(parseAmount('1.')).toBe(100);
  });
});
