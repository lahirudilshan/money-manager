import { describe, expect, it } from 'vitest';
import {
  encodeAcceptance,
  isCurrentAcceptance,
  readAcceptance,
  TERMS,
  TERMS_VERSION,
} from '../terms';

describe('terms acceptance', () => {
  it('round-trips version and time', () => {
    const at = new Date('2026-11-09T10:00:00Z');
    expect(readAcceptance(encodeAcceptance(1, at))).toEqual({ version: 1, at });
  });

  it('needs agreement again when the version goes up', () => {
    const at = new Date();
    expect(isCurrentAcceptance(encodeAcceptance(TERMS_VERSION, at))).toBe(true);
    expect(isCurrentAcceptance(encodeAcceptance(TERMS_VERSION - 1, at))).toBe(false);
  });

  it('treats missing or broken values as not agreed', () => {
    expect(isCurrentAcceptance(undefined)).toBe(false);
    expect(isCurrentAcceptance('')).toBe(false);
    expect(isCurrentAcceptance('garbage')).toBe(false);
  });

  it('tells the user where AI is used and how to turn it off', () => {
    const ai = TERMS.find((s) => s.key === 'ai');
    expect(ai?.points.join(' ')).toMatch(/Settings → AI features/);
  });
});
