import { describe, expect, it } from 'vitest';
import { totalsByHouse } from '../houses';

/**
 * The per-house caption on a bill that was paid for two properties.
 *
 * The user's report was "everything shows on my home". The data was right —
 * each payment carried its house — but nothing on screen ever read the tag, so
 * Electricity showed one lump of 11,900 and the Weligama half was invisible.
 * `totalsByHouse` existed for exactly this and was referenced only by its own
 * tests; these pin it against the real board it now drives.
 */

const OWN = 'plan_house_own';
const WELIGAMA = 'plan_house_weligama';

/** September's real electricity payments. */
const ELECTRICITY = [
  { houseId: OWN, amountMinor: 9_100_00 },
  { houseId: WELIGAMA, amountMinor: 2_800_00 },
];

describe('splitting one bill across two houses', () => {
  it('reports each house separately', () => {
    const totals = totalsByHouse(ELECTRICITY);
    expect(totals.get(OWN)).toBe(9_100_00);
    expect(totals.get(WELIGAMA)).toBe(2_800_00);
  });

  it('still adds up to the line total the header shows', () => {
    // The caption must reconcile with the figure above it, or it reads as a
    // contradiction rather than a breakdown.
    const totals = totalsByHouse(ELECTRICITY);
    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(11_900_00);
  });

  it('sums repeated payments to the same house', () => {
    const totals = totalsByHouse([
      { houseId: OWN, amountMinor: 5_000_00 },
      { houseId: OWN, amountMinor: 4_100_00 },
      { houseId: WELIGAMA, amountMinor: 2_800_00 },
    ]);
    expect(totals.get(OWN)).toBe(9_100_00);
  });

  it('keeps an untagged payment visible rather than folding it into a house', () => {
    /*
     * Untagged is a real state — a payment logged before houses existed. Hiding
     * it would make the breakdown fail to add up to the month's total, and
     * assigning it to the primary house would invent an attribution.
     */
    const totals = totalsByHouse([
      { houseId: null, amountMinor: 1_000_00 },
      { houseId: OWN, amountMinor: 9_100_00 },
    ]);
    expect(totals.get(null)).toBe(1_000_00);
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(10_100_00);
  });

  it('gives one entry for a single-house month, so the caption can hide', () => {
    // The screen only renders the breakdown when there is more than one house
    // in it — otherwise every row would carry the same redundant label.
    expect(totalsByHouse([{ houseId: OWN, amountMinor: 9_100_00 }]).size).toBe(1);
  });

  it('is empty for a month with no payments', () => {
    expect(totalsByHouse([]).size).toBe(0);
  });
});
