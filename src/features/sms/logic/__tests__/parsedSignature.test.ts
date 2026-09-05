import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';

/**
 * Why the paste field reports on a SIGNATURE rather than the parsed object.
 *
 * `parseSms` is pure but returns a fresh object every call, so using its result
 * as an effect dependency created a loop: report -> host setState -> re-render
 * -> new object -> report again. "Maximum update depth exceeded" on the paste
 * screen, forever.
 *
 * These pin the property that makes the fix correct: the same message must
 * produce an equal signature across calls, and a genuinely different one must
 * not.
 */

const sign = (raw: string) => {
  const p = parseSms(raw);
  return p
    ? `${p.direction}|${p.kind}|${p.amountMinor}|${p.currency ?? ''}|${p.merchant}|${p.account}|${p.date ?? ''}`
    : null;
};

const MSG = 'LKR 10,000.00 debited from AC XXXXXXXX6796 on 02 Sep 2026 15:42 as CEFTS Outward Transfer';

describe('the parsed signature', () => {
  /** The object identity differs every call — that was the bug. */
  it('is stable across repeated parses of the same text', () => {
    expect(sign(MSG)).toBe(sign(MSG));
    expect(parseSms(MSG)).not.toBe(parseSms(MSG));
  });

  /** Trailing whitespace is not a new transaction, so it must not re-report. */
  it('ignores changes that do not alter the outcome', () => {
    expect(sign(MSG)).toBe(sign(`${MSG} `));
  });

  it('changes when the amount does', () => {
    expect(sign(MSG)).not.toBe(sign(MSG.replace('10,000.00', '20,000.00')));
  });

  it('changes when the account does', () => {
    expect(sign(MSG)).not.toBe(sign(MSG.replace('6796', '5584')));
  });

  it('is null for text that parses to nothing', () => {
    expect(sign('hello there')).toBeNull();
    expect(sign('')).toBeNull();
  });
});
