import { describe, expect, it } from 'vitest';
import { resolveCardId } from '../planning';

/**
 * Marking an account's money as moved.
 *
 * The real-world step is per ACCOUNT, not per category: a salary lands in one
 * place, and the user moves a lump sum to each account according to what it is
 * for — savings, living costs, vehicle-and-health. What they need to remember
 * is "have I moved money to the vehicle account yet?", and asking that once per
 * category made them answer the same question several times for one transfer.
 *
 * The store writes the answer through to `category_states`, so this pins the
 * two rules that decide what gets written: WHICH categories an account funds,
 * and WHICH WAY a tap should flip them.
 */

interface Line {
  categoryId: string;
  type: 'income' | 'expense';
  cardId: string | null;
}

interface Category {
  id: string;
  cardId: string | null;
}

/** `toggleAccountTransfer`'s first half: the categories an account funds. */
function fundedCategoryIds(
  cardId: string,
  categories: readonly Category[],
  lines: readonly Line[],
): string[] {
  return categories
    .filter((category) =>
      lines.some(
        (line) =>
          line.categoryId === category.id &&
          line.type === 'expense' &&
          resolveCardId(line.cardId, category.cardId) === cardId,
      ),
    )
    .map((category) => category.id);
}

/** Its second half: one tap sets them all the same way. */
function nextStatus(
  ids: readonly string[],
  states: Map<string, 'pending' | 'transferred'>,
): 'pending' | 'transferred' {
  const allTransferred = ids.every((id) => (states.get(id) ?? 'pending') === 'transferred');
  return allTransferred ? 'pending' : 'transferred';
}

const HNB = 'card-hnb';
const BOC = 'card-boc';

describe('which categories an account funds', () => {
  it('finds categories whose own card is the account', () => {
    const categories = [
      { id: 'living', cardId: HNB },
      { id: 'savings', cardId: BOC },
    ];
    const lines: Line[] = [
      { categoryId: 'living', type: 'expense', cardId: null },
      { categoryId: 'savings', type: 'expense', cardId: null },
    ];

    expect(fundedCategoryIds(HNB, categories, lines)).toEqual(['living']);
  });

  /**
   * A single line can override its category's account, and that override is
   * what decides where the money actually has to go.
   */
  it('follows a line-level account override', () => {
    const categories = [{ id: 'vehicle', cardId: BOC }];
    const lines: Line[] = [{ categoryId: 'vehicle', type: 'expense', cardId: HNB }];

    expect(fundedCategoryIds(HNB, categories, lines)).toEqual(['vehicle']);
    expect(fundedCategoryIds(BOC, categories, lines)).toEqual([]);
  });

  /** Income arrives in an account by itself; nothing is moved TO it. */
  it('ignores income lines', () => {
    const categories = [{ id: 'salary', cardId: HNB }];
    const lines: Line[] = [{ categoryId: 'salary', type: 'income', cardId: null }];

    expect(fundedCategoryIds(HNB, categories, lines)).toEqual([]);
  });

  it('returns nothing for an account no line draws on', () => {
    const categories = [{ id: 'living', cardId: HNB }];
    const lines: Line[] = [{ categoryId: 'living', type: 'expense', cardId: null }];

    expect(fundedCategoryIds(BOC, categories, lines)).toEqual([]);
  });
});

describe('which way a tap flips the account', () => {
  it('marks a fully pending account as transferred', () => {
    const states = new Map<string, 'pending' | 'transferred'>();

    expect(nextStatus(['living', 'utilities'], states)).toBe('transferred');
  });

  it('undoes a fully transferred account', () => {
    const states = new Map<string, 'pending' | 'transferred'>([
      ['living', 'transferred'],
      ['utilities', 'transferred'],
    ]);

    expect(nextStatus(['living', 'utilities'], states)).toBe('pending');
  });

  /**
   * The case that decides the rule.
   *
   * A half-transferred account has to resolve to "mark the rest" — flipping
   * each category independently would leave it just as mixed, so the tap would
   * appear to do nothing at all.
   */
  it('completes a half-transferred account rather than flipping each', () => {
    const states = new Map<string, 'pending' | 'transferred'>([['living', 'transferred']]);

    expect(nextStatus(['living', 'utilities'], states)).toBe('transferred');
  });
});
