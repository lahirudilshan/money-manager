import { describe, expect, it } from 'vitest';
import { fileUnderHouseLine, houseForLine, type HouseLike } from '../houses';

/**
 * Confirming SEVERAL drafts in a row, which is how the queue is actually used.
 *
 * The bug this pins: the review screen seeds its state with `useState`, which
 * runs once per mount, and the screen is reused as the queue is worked through.
 * So the second draft inherited the first one's house and target line — and
 * once naming a house FILES the payment under that house's line, the stale
 * value stopped being cosmetic and became money in the wrong place. Confirming
 * a Weligama bill and then an own-home one sent both to Weligama.
 *
 * Each confirmation must be judged only on its OWN choice.
 */

const HOUSES: (HouseLike & { name: string })[] = [
  { id: 'own', name: 'My home', isPrimary: true },
  { id: 'weligama', name: 'Weligama', isPrimary: false },
];

const HOUSE_LINES = [{ subcategoryId: 'sub-weligama-home', houseId: 'weligama' }];

/** One confirmation: the line suggested, and the house the user picked. */
function fileOne(suggestedLine: string, chosenHouse: string | null) {
  return fileUnderHouseLine(chosenHouse, HOUSES, HOUSE_LINES) ?? suggestedLine;
}

describe('working through a queue of drafts', () => {
  it('files a parents-house bill away and keeps the NEXT own-home one in place', () => {
    // The exact sequence that failed on the simulator.
    expect(fileOne('sub-electricity', 'weligama')).toBe('sub-weligama-home');
    expect(fileOne('sub-electricity', 'own')).toBe('sub-electricity');
  });

  it('is unaffected by the order the two are confirmed in', () => {
    expect(fileOne('sub-water', 'own')).toBe('sub-water');
    expect(fileOne('sub-water', 'weligama')).toBe('sub-weligama-home');
  });

  it('files all four of the real bills correctly, in queue order', () => {
    const queue: [string, string | null][] = [
      ['sub-electricity', 'weligama'],
      ['sub-water', 'weligama'],
      ['sub-electricity', 'own'],
      ['sub-water', 'own'],
    ];
    expect(queue.map(([line, house]) => fileOne(line, house))).toEqual([
      'sub-weligama-home',
      'sub-weligama-home',
      'sub-electricity',
      'sub-water',
    ]);
  });

  it('leaves a draft alone when no house was chosen at all', () => {
    // A fresh screen must default to "no override", never to the last answer.
    expect(fileOne('sub-electricity', null)).toBe('sub-electricity');
  });

  it('does not match a house line for an ordinary bill name', () => {
    // Guards the other half: the suggestion itself must not be mistaken for a
    // property line just because a house name appears nearby.
    expect(houseForLine('Electricity bill', HOUSES)).toBeNull();
    expect(houseForLine('Weligama home', HOUSES)).toBe('weligama');
  });
});
