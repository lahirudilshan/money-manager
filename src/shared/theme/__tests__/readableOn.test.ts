import { describe, expect, it } from 'vitest';
import { readableOn } from '~/shared/theme';

/** WCAG relative luminance, duplicated here so the test checks the real rule. */
function contrast(a: string, b: string): number {
  const parse = (hex: string) =>
    [0, 2, 4].map((offset) => Number.parseInt(hex.replace('#', '').slice(offset, offset + 2), 16));
  const luminance = (rgb: number[]) => {
    const linear = rgb
      .map((c) => c / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const LIGHT = '#FFFFFF';
const DARK = '#101828';

describe('readableOn', () => {
  it('leaves a colour that already passes untouched', () => {
    // A dark navy on white is already well past AA.
    expect(readableOn('#101828', LIGHT)).toBe('#101828');
  });

  // BOC's yellow is the case this exists for: ~1.6:1 on white, unreadable.
  it('darkens a pale hue until it is readable on a light ground', () => {
    const result = readableOn('#FFD100', LIGHT);
    expect(result).not.toBe('#FFD100');
    expect(contrast(result, LIGHT)).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * The direction has to follow the BACKGROUND. A white-only version of this
   * darkens on a dark ground too, which makes the colour vanish entirely —
   * the exact bug this test pins.
   */
  it('lightens rather than darkens on a dark ground', () => {
    const result = readableOn('#0B3B2E', DARK);
    expect(contrast(result, DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches the threshold for every bank hue in the catalog, both themes', () => {
    const hues = ['#FFD100', '#055841', '#0B3B2E', '#E11D48', '#2563EB', '#65A30D', '#57534E'];
    for (const hue of hues) {
      expect(contrast(readableOn(hue, LIGHT), LIGHT)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(readableOn(hue, DARK), DARK)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('honours a custom minimum', () => {
    // 3:1 is the large-text threshold; it should stop earlier than for 4.5.
    const relaxed = readableOn('#FFD100', LIGHT, 3);
    expect(contrast(relaxed, LIGHT)).toBeGreaterThanOrEqual(3);
  });

  // Rendering something the caller chose beats rendering nothing.
  it('returns a malformed colour unchanged rather than throwing', () => {
    expect(readableOn('not-a-colour', LIGHT)).toBe('not-a-colour');
    expect(readableOn('#FFF', LIGHT)).toBe('#FFF');
    expect(readableOn('#FFD100', 'nonsense')).toBe('#FFD100');
  });

  it('always returns a parseable 6-digit hex when it does adjust', () => {
    expect(readableOn('#FFD100', LIGHT)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
