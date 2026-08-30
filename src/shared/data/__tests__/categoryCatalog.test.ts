import { describe, expect, it } from 'vitest';
import {
  CATALOG_SUBCATEGORY_BY_ID,
  CATEGORY_CATALOG,
  ONBOARDING_CATALOG,
} from '../categoryCatalog';

describe('category catalog', () => {
  it('has no duplicate ids across categories or lines', () => {
    /*
     * Ids are the join key for SMS routing, house scoping and restore, so a
     * duplicate silently sends one of the two lines' payments to the other.
     */
    const ids = [
      ...CATEGORY_CATALOG.map((c) => c.id),
      ...CATEGORY_CATALOG.flatMap((c) => c.subcategories.map((s) => s.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every line through the flat lookup', () => {
    for (const category of CATEGORY_CATALOG) {
      for (const line of category.subcategories) {
        expect(CATALOG_SUBCATEGORY_BY_ID.get(line.id)?.category.id).toBe(category.id);
      }
    }
  });

  it('does not give Debt the icon of any single debt product', () => {
    /*
     * Debt is the one category whose lines are distinct PRODUCTS — a card, a
     * lease, a mortgage, a pawning. Wearing one of their icons made the group
     * read as a second copy of that product (it carried `card-outline` beside
     * its own Credit card line, then `cash-outline` beside Personal loan).
     *
     * Deliberately narrower than "no category may share an icon with its
     * lines": Housing/Rent and Living/Groceries share one quite sensibly, since
     * there the line IS the archetype of its group.
     */
    const debt = CATEGORY_CATALOG.find((category) => category.id === 'loans');
    expect(debt).toBeDefined();
    expect(debt!.subcategories.map((line) => line.icon)).not.toContain(debt!.icon);
  });

  it('covers pets, device instalments and the monthly buffer', () => {
    /*
     * Three costs common enough to belong in a shared catalog, each of which
     * otherwise lands on a line that then reads wrong: a vet bill filed under
     * Medicine, a phone instalment under Credit card, and the month's small
     * surprises under whatever line is nearest.
     */
    for (const id of ['pet', 'device-instalment', 'buffer']) {
      expect(CATALOG_SUBCATEGORY_BY_ID.has(id)).toBe(true);
    }
  });

  it('files the buffer as ongoing, not a single monthly payment', () => {
    // It holds many small unrelated entries; a monthly line would keep only the
    // last one as its actual, silently discarding the rest.
    expect(CATALOG_SUBCATEGORY_BY_ID.get('buffer')?.subcategory.frequency).toBe('ongoing');
  });

  it('files every ongoing line as ongoing', () => {
    /*
     * These are charged MANY times a month rather than once. A `monthly` line
     * keeps a single actual per period, so the second grocery run — or the
     * second mobile reload, or the third parking charge — would overwrite the
     * first instead of adding to it, and the total would under-report all month.
     */
    for (const id of [
      'groceries',
      'dining',
      'fuel',
      'medicine',
      'pet',
      'buffer',
      'bank-charges',
      // Charged repeatedly even though people think of them as "a bill":
      // reloads and data packs, broadband add-ons and a second connection.
      'mobile',
      'internet',
      // Bought or paid AS NEEDED rather than invoiced once: a gas cylinder when
      // it runs out, a helper per visit, a class pack, a session of childcare.
      'gas',
      'domestic-help',
      'garbage',
      'gym',
      'childcare',
      'parking',
      'public-transport',
      'cash',
      'household',
      'doctor',
      'maintenance',
      'travel',
    ]) {
      expect(CATALOG_SUBCATEGORY_BY_ID.get(id)?.subcategory.frequency).toBe('ongoing');
    }
  });

  it('keeps genuine one-payment bills on a dated frequency', () => {
    /*
     * The counterpart rule: these ARE settled by a single payment on a date, so
     * they keep a due-day worth prompting about and are ticked paid once.
     * Making them ongoing would lose that prompt and ask the user to log an
     * entry for a bill that simply gets paid.
     */
    for (const id of [
      'rent',
      'electricity',
      'water',
      'personal-loan',
      'lease',
      'housing-loan',
      'credit-card',
      'device-instalment',
      'school-fees',
      'streaming',
      'health-insurance',
    ]) {
      const line = CATALOG_SUBCATEGORY_BY_ID.get(id)?.subcategory;
      expect(line?.frequency ?? 'monthly').not.toBe('ongoing');
    }
  });

  it('offers the new lines during onboarding', () => {
    // All three sit in categories step 2 actually renders — a line nobody can
    // pick is a line that does not exist.
    const offered = new Set(
      ONBOARDING_CATALOG.flatMap((c) => c.subcategories.map((s) => s.id)),
    );
    expect(offered.has('pet')).toBe(true);
    expect(offered.has('buffer')).toBe(true);
    // `device-instalment` lives under `loans`, which step 2 hides on purpose.
    expect(offered.has('device-instalment')).toBe(false);
  });
});
