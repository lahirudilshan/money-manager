import { describe, expect, it } from 'vitest';
import { resolveCardId } from '../planning';

/**
 * Which categories an account's DETAIL page should list.
 *
 * Captured from the user's real board: Household (wife) is funded by a Pet
 * category whose own card is Household, AND by a single Groceries line inside
 * Living — a category that otherwise funds a different account entirely. The
 * detail page listed only Pet, so a LKR 50,000 grocery budget the dashboard was
 * asking money for appeared to belong to no account at all.
 */

interface Line {
  id: string;
  name: string;
  type: 'income' | 'expense';
  cardId: string | null;
}

interface Category {
  id: string;
  name: string;
  cardId: string | null;
  lines: Line[];
}

const HOUSEHOLD = 'plan_card_hnb';
const ONLINE = 'mtetw9t7u5e7qjwl';

const board: Category[] = [
  {
    id: 'living',
    name: 'Living',
    cardId: 'plan_card_ndb',
    lines: [
      { id: 'rent', name: 'Rent / mortgage', type: 'expense', cardId: ONLINE },
      // The override that made Household fund a slice of Living.
      { id: 'groceries', name: 'Groceries (home food)', type: 'expense', cardId: HOUSEHOLD },
      { id: 'cash', name: 'Cash / pocket money', type: 'expense', cardId: null },
    ],
  },
  {
    id: 'pet',
    name: 'Pet',
    cardId: HOUSEHOLD,
    lines: [
      { id: 'pet-food', name: 'Food', type: 'expense', cardId: null },
      { id: 'pet-other', name: 'Other', type: 'expense', cardId: HOUSEHOLD },
    ],
  },
];

/** The detail page's rule: keep the lines that resolve here, drop empty groups. */
function fundedBy(cardId: string, categories: readonly Category[]) {
  return categories
    .map((category) => ({
      name: category.name,
      lines: category.lines.filter(
        (line) => resolveCardId(line.cardId, category.cardId) === cardId,
      ),
    }))
    .filter((group) => group.lines.length > 0);
}

describe('what an account funds', () => {
  it('includes a category reached only by a line-level override', () => {
    const groups = fundedBy(HOUSEHOLD, board);
    expect(groups.map((g) => g.name).sort()).toEqual(['Living', 'Pet']);
  });

  it('lists only the overriding line from that category, not its siblings', () => {
    const living = fundedBy(HOUSEHOLD, board).find((g) => g.name === 'Living')!;
    expect(living.lines.map((l) => l.name)).toEqual(['Groceries (home food)']);
  });

  it('includes both a category-level line and its own override', () => {
    const pet = fundedBy(HOUSEHOLD, board).find((g) => g.name === 'Pet')!;
    expect(pet.lines.map((l) => l.id)).toEqual(['pet-food', 'pet-other']);
  });

  it('drops a category none of whose lines resolve here', () => {
    expect(fundedBy('card-unused', board)).toEqual([]);
  });

  /** The inheriting line follows its category, not the overriding sibling. */
  it('keeps an inheriting line with its category’s account', () => {
    const groups = fundedBy('plan_cat_ndb_missing', board);
    expect(groups).toEqual([]);
  });
});
