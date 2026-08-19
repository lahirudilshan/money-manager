import { describe, expect, it } from 'vitest';
import { CATEGORY_CATALOG } from '~/shared/data/categoryCatalog';
import {
  defaultHouseId,
  isHouseCatalogId,
  PLACEHOLDER_HOUSES,
  isHouseScopedCatalogId,
  isHouseScopedHint,
  isHouseScopedName,
  shouldAskForHouse,
  totalsByHouse,
} from '../houses';

const HOME = { id: 'home', isPrimary: true };
const WELIGAMA = { id: 'weligama', isPrimary: false };

describe('shouldAskForHouse', () => {
  it('never asks when there is only one house', () => {
    // The design contract: a single-home user must not see this feature at all,
    // because with one house every payment has exactly one possible answer.
    expect(shouldAskForHouse([HOME], true)).toBe(false);
  });

  it('never asks when there are no houses', () => {
    expect(shouldAskForHouse([], true)).toBe(false);
  });

  it('never asks on a line that is not house-scoped', () => {
    // A Netflix subscription or a salary belongs to no property, so asking is
    // noise even for a user who keeps three houses.
    expect(shouldAskForHouse([HOME, WELIGAMA], false)).toBe(false);
  });

  it('asks only when there are several houses AND the line is scoped', () => {
    expect(shouldAskForHouse([HOME, WELIGAMA], true)).toBe(true);
  });
});

describe('defaultHouseId', () => {
  it("prefers the line's own default over the primary house", () => {
    // A bill the user has already told us is "the Weligama electricity" must
    // not revert to their own home every month.
    expect(defaultHouseId([HOME, WELIGAMA], 'weligama')).toBe('weligama');
  });

  it('falls back to the primary house', () => {
    expect(defaultHouseId([HOME, WELIGAMA], null)).toBe('home');
  });

  it('ignores a stale default pointing at a deleted house', () => {
    // Deleting a house sets referencing rows to null; a line still naming it
    // must not resolve to an id that no longer exists.
    expect(defaultHouseId([HOME, WELIGAMA], 'sold-last-year')).toBe('home');
  });

  it('uses the only house when none is flagged primary', () => {
    expect(defaultHouseId([WELIGAMA], null)).toBe('weligama');
  });

  it('returns null rather than guessing between unflagged houses', () => {
    // An attribution the user never made would quietly load one property's
    // total with another's spending — worse than leaving it blank.
    expect(defaultHouseId([WELIGAMA, { id: 'other', isPrimary: false }], null)).toBeNull();
  });

  it('returns null when there are no houses', () => {
    expect(defaultHouseId([], null)).toBeNull();
  });
});

describe('house scoping rules', () => {
  it('scopes the metered utilities and the tenancy', () => {
    for (const id of ['electricity', 'water', 'rent', 'gas', 'internet']) {
      expect(isHouseScopedCatalogId(id)).toBe(true);
    }
  });

  it('scopes support-to-parents, the line a second house shows up on', () => {
    expect(isHouseScopedCatalogId('parents')).toBe(true);
  });

  it('does not scope spending that follows the person, not the building', () => {
    // Tagging every supermarket run with a house is exactly the busywork this
    // feature must avoid.
    for (const id of ['groceries', 'fuel', 'streaming', 'salary', 'dining']) {
      expect(isHouseScopedCatalogId(id)).toBe(false);
    }
  });

  it('scopes the SMS hints that identify a per-property bill', () => {
    expect(isHouseScopedHint('electricity')).toBe(true);
    expect(isHouseScopedHint('water')).toBe(true);
    // Sending money to a parents' house is how a second property is often paid.
    expect(isHouseScopedHint('transfer')).toBe(true);
  });

  it('does not scope unrelated hints, or a missing one', () => {
    expect(isHouseScopedHint('groceries')).toBe(false);
    expect(isHouseScopedHint('loan')).toBe(false);
    expect(isHouseScopedHint(null)).toBe(false);
  });
});

describe('isHouseScopedName — retroactive scoping of an existing board', () => {
  /*
   * A board built before houses existed has every line at `house_scoped = 0`,
   * so adding a second house would change nothing visible and the feature would
   * look broken. These names are read to fix that in place.
   */
  it('recognises the per-property bills by name', () => {
    for (const name of [
      'Electricity (CEB / LECO)',
      'Electricity',
      'Water',
      'Rent / mortgage',
      'Internet / broadband',
      'Gas',
      'Support to parents',
      'Repairs & maintenance',
      'Garbage / municipal',
    ]) {
      expect(isHouseScopedName(name)).toBe(true);
    }
  });

  it('leaves everything else alone', () => {
    // A false positive is a picker appearing on a bill that has nothing to do
    // with a building — exactly the noise the feature promises to avoid.
    for (const name of [
      'Groceries',
      'Fuel',
      'Netflix',
      'Salary',
      'Personal loan',
      'Health insurance',
      'Eating out',
      'Mobile / phone bill',
    ]) {
      expect(isHouseScopedName(name)).toBe(false);
    }
  });

  it('matches on the category name too, not only the line', () => {
    // Lines are matched as "<line name> <category name>", so a bare "Monthly"
    // under "Electricity" is still recognised.
    expect(isHouseScopedName('Monthly Electricity')).toBe(true);
  });
});

describe('houses as a catalog category', () => {
  it('recognises a house line by its catalog id', () => {
    // Picking one of these creates a `houses` ROW, not just a budget line —
    // that is what makes the picker appear on the bills.
    for (const id of ['house-own', 'house-parents', 'house-second', 'house-rented-out']) {
      expect(isHouseCatalogId(id)).toBe(true);
    }
  });

  it('does not mistake an ordinary bill for a house', () => {
    for (const id of ['electricity', 'water', 'rent', 'groceries', 'salary']) {
      expect(isHouseCatalogId(id)).toBe(false);
    }
  });

  it('ships every house line as unplanned', () => {
    /*
     * A house's cost is the SUM of its bills, not one figure paid monthly. A
     * `monthly` line would hold a single "actual" per month, so the second bill
     * tagged to that house would overwrite the first instead of adding to it.
     */
    const houses = CATEGORY_CATALOG.find((category) => category.id === 'houses');
    expect(houses).toBeDefined();
    for (const line of houses!.subcategories) {
      expect(line.frequency).toBe('unplanned');
    }
  });

  it('keeps the per-BILL lines separate from the per-HOUSE lines', () => {
    /*
     * The two must not collide: Housing → Electricity is where the electricity
     * budget lives, and Houses → Weligama is where that house's total
     * accumulates. If a catalog id were in both sets, a payment would have two
     * equally valid homes and the totals would double.
     */
    const houses = CATEGORY_CATALOG.find((category) => category.id === 'houses')!;
    for (const line of houses.subcategories) {
      expect(isHouseScopedCatalogId(line.id)).toBe(false);
    }
  });
});

describe('placeholder houses', () => {
  it('seeds exactly one primary', () => {
    // `defaultHouseId` needs a primary to fall back on, and two would make
    // "which house by default" a coin toss.
    expect(PLACEHOLDER_HOUSES.filter((house) => house.isPrimary)).toHaveLength(1);
  });

  it('seeds enough houses for the picker to appear', () => {
    // With fewer than two, `shouldAskForHouse` is false and the feature stays
    // invisible — which is the bug the seed exists to fix.
    expect(PLACEHOLDER_HOUSES.length).toBeGreaterThan(1);
    expect(shouldAskForHouse(PLACEHOLDER_HOUSES.map((h, i) => ({ ...h, id: String(i) })), true)).toBe(
      true,
    );
  });
});

describe('totalsByHouse', () => {
  it('sums per house', () => {
    const totals = totalsByHouse([
      { houseId: 'home', amountMinor: 250_000 },
      { houseId: 'weligama', amountMinor: 427_086 },
      { houseId: 'weligama', amountMinor: 1_000_000 },
    ]);

    expect(totals.get('home')).toBe(250_000);
    expect(totals.get('weligama')).toBe(1_427_086);
  });

  it('keeps unattributed spend under null instead of hiding it', () => {
    // Folding it into the primary house would make per-house figures quietly
    // fail to add up to the month's total.
    const totals = totalsByHouse([
      { houseId: null, amountMinor: 2_500 },
      { houseId: 'home', amountMinor: 250_000 },
    ]);

    expect(totals.get(null)).toBe(2_500);
    expect(totals.get('home')).toBe(250_000);
  });
});
