import { describe, expect, it } from 'vitest';
import { isValidPin, PIN_LENGTH } from '~/shared/lib/appPin';

/**
 * The only pure part of the PIN service — everything else touches the keystore.
 * Worth pinning because a loose check here would let an empty or partial PIN be
 * stored as the sole way into the app.
 */
describe('isValidPin', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('4150')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidPin('')).toBe(false);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
  });

  it('rejects anything that is not a digit', () => {
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('12 4')).toBe(false);
    expect(isValidPin('1.24')).toBe(false);
    expect(isValidPin('-123')).toBe(false);
  });

  it('rejects digits with surrounding whitespace rather than trimming', () => {
    // The entry UI appends one character at a time, so a padded value means
    // something upstream is wrong — better to reject than silently accept.
    expect(isValidPin(' 123')).toBe(false);
    expect(isValidPin('1234 ')).toBe(false);
  });

  it('matches the exported length', () => {
    expect(isValidPin('9'.repeat(PIN_LENGTH))).toBe(true);
    expect(isValidPin('9'.repeat(PIN_LENGTH + 1))).toBe(false);
  });
});
