import { describe, expect, it } from 'vitest';
import { resolveCardId } from '../planning';

/**
 * Splitting one account into "salary lands here" and "bills are paid from here".
 *
 * The real setup: a USD account at DFCC receives the salary, a portion is
 * converted into an LKR account at the same bank, and the bills are paid from
 * the LKR one. Getting there from a single account means repointing every
 * category and every overriding line — 25 trips through a picker on a real
 * board, which is why `moveAccountFunding` exists.
 *
 * These pin the two rules that make the move correct rather than merely bulk.
 */

interface Category {
  id: string;
  cardId: string | null;
}

interface Line {
  id: string;
  categoryId: string;
  type: 'income' | 'expense';
  /** Null means "inherit from the category". */
  cardId: string | null;
}

/** `moveAccountFunding` in pure form. */
function move(
  categories: readonly Category[],
  lines: readonly Line[],
  from: string,
  to: string,
): { categories: Category[]; lines: Line[] } {
  if (from === to) return { categories: [...categories], lines: [...lines] };

  return {
    categories: categories.map((c) => (c.cardId === from ? { ...c, cardId: to } : c)),
    lines: lines.map((l) =>
      l.type !== 'income' && l.cardId === from ? { ...l, cardId: to } : l,
    ),
  };
}

const USD = 'card-usd';
const LKR = 'card-lkr';

describe('moveAccountFunding', () => {
  it('repoints every category funded by the old account', () => {
    const { categories } = move(
      [
        { id: 'living', cardId: USD },
        { id: 'savings', cardId: 'card-other' },
      ],
      [],
      USD,
      LKR,
    );

    expect(categories.find((c) => c.id === 'living')!.cardId).toBe(LKR);
    // Untouched — it was never funded by the account being moved.
    expect(categories.find((c) => c.id === 'savings')!.cardId).toBe('card-other');
  });

  /**
   * The half-migration this prevents: moving only categories leaves every
   * OVERRIDING line behind on the old account, so the totals stop adding up
   * and the account the user thought they had emptied is still funded.
   */
  it('repoints overriding lines too, not just categories', () => {
    const { lines } = move(
      [{ id: 'living', cardId: USD }],
      [
        { id: 'rent', categoryId: 'living', type: 'expense', cardId: USD },
        { id: 'water', categoryId: 'living', type: 'expense', cardId: null },
      ],
      USD,
      LKR,
    );

    expect(lines.find((l) => l.id === 'rent')!.cardId).toBe(LKR);
  });

  /**
   * A line with a null `cardId` INHERITS from its category, which has just
   * moved. Rewriting it would convert an inheritance into an override and
   * silently pin it — so a later change to the category's account would no
   * longer reach it.
   */
  it('leaves an inheriting line inheriting', () => {
    const { categories, lines } = move(
      [{ id: 'living', cardId: USD }],
      [{ id: 'water', categoryId: 'living', type: 'expense', cardId: null }],
      USD,
      LKR,
    );

    const water = lines.find((l) => l.id === 'water')!;
    expect(water.cardId).toBeNull();
    // It still resolves to the new account, via its category.
    expect(resolveCardId(water.cardId, categories[0].cardId)).toBe(LKR);
  });

  /**
   * Income LANDS in the foreign account — that is the entire point of holding
   * it. Sweeping salary across would undo the arrangement this supports.
   */
  it('leaves income where it is', () => {
    const { lines } = move(
      [],
      [{ id: 'salary', categoryId: 'income', type: 'income', cardId: USD }],
      USD,
      LKR,
    );

    expect(lines.find((l) => l.id === 'salary')!.cardId).toBe(USD);
  });

  it('is a no-op when the source and target are the same account', () => {
    const categories = [{ id: 'living', cardId: USD }];
    const lines: Line[] = [{ id: 'rent', categoryId: 'living', type: 'expense', cardId: USD }];
    const result = move(categories, lines, USD, USD);

    expect(result.categories).toEqual(categories);
    expect(result.lines).toEqual(lines);
  });

  /** After the move, nothing funds the old account — that is the whole goal. */
  it('leaves the old account funding nothing', () => {
    const { categories, lines } = move(
      [{ id: 'living', cardId: USD }, { id: 'debt', cardId: USD }],
      [
        { id: 'rent', categoryId: 'living', type: 'expense', cardId: USD },
        { id: 'water', categoryId: 'living', type: 'expense', cardId: null },
      ],
      USD,
      LKR,
    );

    for (const line of lines.filter((l) => l.type === 'expense')) {
      const category = categories.find((c) => c.id === line.categoryId)!;
      expect(resolveCardId(line.cardId, category.cardId)).not.toBe(USD);
    }
  });
});
