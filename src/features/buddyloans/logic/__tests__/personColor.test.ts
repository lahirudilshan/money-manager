import { describe, expect, it } from 'vitest';
import { personColor } from '../buddyLoans';

/*
 * The app's real `groupColors`, not a shortened stand-in.
 *
 * Collision behaviour depends on the palette SIZE, so testing against a
 * truncated one proves nothing about what ships — a six-colour version of this
 * list collides "Amma" with "Appa" where the real eight-colour one does not.
 */
const PALETTE = [
  '#0F6FDE',
  '#0E9F6E',
  '#B7791F',
  '#0FA8A0',
  '#5B6472',
  '#2E6BB8',
  '#7C8A3D',
  '#0891B2',
];

describe('personColor', () => {
  it('gives the same person the same colour every time', () => {
    // The whole point: a name must not change colour between screens or
    // between launches, or the colour stops being a way to recognise anyone.
    expect(personColor('Nuwan', PALETTE)).toBe(personColor('Nuwan', PALETTE));
  });

  it('ignores case and surrounding space, like the rest of the feature', () => {
    expect(personColor('nuwan', PALETTE)).toBe(personColor('  Nuwan ', PALETTE));
  });

  it('always returns a colour from the palette', () => {
    for (const name of ['Nuwan', 'Kasun', 'Amma', 'Sanjeewa', 'Dilan', 'Ruwan', 'X']) {
      expect(PALETTE).toContain(personColor(name, PALETTE));
    }
  });

  it('spreads a realistic set of names across several colours', () => {
    /*
     * Not a guarantee of zero collisions — with six colours and six names some
     * sharing is inevitable — but a hash that lumped everyone together would
     * defeat the point entirely, so the spread is asserted.
     */
    const names = ['Nuwan', 'Kasun', 'Amma', 'Sanjeewa', 'Dilan', 'Ruwan'];
    const used = new Set(names.map((n) => personColor(n, PALETTE)));
    expect(used.size).toBeGreaterThanOrEqual(5);
  });

  it('separates names differing by ONE letter', () => {
    // Short names sharing letters are the common case in a family, and a
    // char-code sum would collide on exactly these.
    expect(personColor('Amma', PALETTE)).not.toBe(personColor('Appa', PALETTE));
  });

  it('never returns undefined for an empty or blank name', () => {
    expect(PALETTE).toContain(personColor('', PALETTE));
    expect(PALETTE).toContain(personColor('   ', PALETTE));
  });

  it('survives an empty palette rather than crashing', () => {
    expect(typeof personColor('Nuwan', [])).toBe('string');
  });
});
