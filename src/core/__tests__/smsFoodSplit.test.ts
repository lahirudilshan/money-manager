import { describe, expect, it } from 'vitest';
import { guessCategories, lineMatchesCategory } from '../merchantSignals';
import { inferCategoryHint, billMatchesHint } from '../smsCategoryHints';
import { reconcileSms } from '../smsReconcile';
import { parseSms } from '../smsParser';
import { suggestedLines } from '../personas';
import { CATEGORY_CATALOG } from '../../data/categoryCatalog';

/**
 * Food at home vs food from outside, as two separate lines.
 *
 * They are the same substance bought two ways, and merging them answers
 * neither question a budget asks: groceries are a fairly fixed monthly need,
 * while eating out is the most elastic line most people have. A single "Food"
 * total that goes up says nothing about whether to shop differently or order
 * less.
 *
 * The split only works if detection can tell them apart, which is what these
 * cover — the catalog and onboarding halves are cheap, the classification half
 * is where the real bugs were.
 */

const BOARD = {
  subcategories: [
    { id: 'groc', name: 'Groceries (home food)', type: 'expense' as const, plannedMinor: 5_000_000, categoryId: 'c1', cardId: null, loanId: null },
    { id: 'dine', name: 'Eating out & delivery', type: 'expense' as const, plannedMinor: 1_500_000, categoryId: 'c1', cardId: null, loanId: null },
    { id: 'tra', name: 'Transport', type: 'expense' as const, plannedMinor: 1_000_000, categoryId: 'c1', cardId: null, loanId: null },
  ],
  categories: [{ id: 'c1', name: 'Living', cardId: null }],
  cards: [],
};

/** Top-scoring category for a merchant name, or null. */
const guess = (merchant: string) =>
  guessCategories({ merchant, raw: '', kind: 'purchase' })[0]?.category ?? null;

describe('food delivery sold by a ride-hailing company', () => {
  it('reads UBER EATS as eating out, not a taxi', () => {
    /*
     * The bug this split exists to fix. "UBER" is a transport brand, so a food
     * order scored transport 0.91 with nothing to contest it — the user's real
     * UBER EATS row was being filed as a ride. The two-word service name is the
     * discriminator.
     */
    expect(guess('UBER EATS, LK')).toBe('dining');
  });

  it('reads PICKME FOOD as eating out, not a taxi', () => {
    expect(guess('PICKME FOOD')).toBe('dining');
  });

  it('still reads the ride-hailing brands alone as transport', () => {
    // The other half of the guard: fixing delivery must not cost real rides.
    expect(guess('UBER TRIP')).toBe('transport');
    expect(guess('PICKME')).toBe('transport');
  });

  it('lands an UBER EATS alert on the eating-out line', () => {
    const sms =
      'HNB SMS ALERT:INTERNET, Account:1380***6626,Location:UBER EATS, LK,Amount(Approx.):3497.91 LKR,Av.Bal:21427.48 LKR,Date:16.08.26,Time:01:29';
    const draft = reconcileSms(parseSms(sms)!, BOARD, 'd1');
    expect(draft.hint).toBe('dining');
    expect(draft.subcategoryId).toBe('dine');
  });
});

describe('telling the two food lines apart', () => {
  it.each([
    ['KEELLS SUPER', 'groceries'],
    ['FOOD CITY', 'groceries'],
    ['BEN FOODS', 'groceries'],
    ['grocery shopping', 'groceries'],
    ['PIZZA HUT', 'dining'],
    ['KFC NUGEGODA', 'dining'],
    ['MCDONALDS', 'dining'],
    ['CAFE KUMBUK', 'dining'],
    ['restaurant bill', 'dining'],
  ])('reads %s as %s', (merchant, category) => {
    expect(guess(merchant)).toBe(category);
  });

  it('reads the meal words a typed transfer reason uses', () => {
    /*
     * Someone annotating their own transfer writes "dinner with family", never
     * "restaurant" — and those scored nothing at all before, so the transfer
     * arrived with no category despite saying what it was.
     */
    expect(guess('dinner with family')).toBe('dining');
    expect(guess('lunch')).toBe('dining');
    expect(guess('takeaway')).toBe('dining');
  });

  it('sends a bare "food delivery" to eating out, not groceries', () => {
    /*
     * The generic grocery word `food` sits at position 0 here and took the
     * lead-name bonus, so groceries beat dining 0.91 to 0.85 and a delivery was
     * filed as a supermarket run. The specific phrase has to win.
     */
    expect(guess('food delivery')).toBe('dining');
  });

  it('sends "outside food" to eating out', () => {
    // The user's own phrase for the non-grocery half.
    expect(guess('outside food')).toBe('dining');
  });

  it('still sends an unqualified "food expenses" to groceries', () => {
    /*
     * Deliberate: a bare mention of food, with nothing saying it was bought
     * outside, is the at-home reading. This is the user's real 40,000 transfer.
     */
    expect(guess('food expenses')).toBe('groceries');
  });
});

/**
 * Each line must answer to its OWN category and not the other's.
 *
 * Both self-word lists carried a bare `food`, so "Groceries (home food)" and
 * "Eating out & delivery" each matched both guesses. The two lines tied at 0.50
 * and the winner fell to board order — the hint said dining and the money went
 * to Groceries anyway.
 */
describe('matching a guess to the right board line', () => {
  it('does not let the groceries line answer to dining', () => {
    expect(lineMatchesCategory('dining', 'Groceries (home food) Living')).toBe(false);
    expect(billMatchesHint('dining', 'Groceries (home food) Living')).toBe(false);
  });

  it('does not let the eating-out line answer to groceries', () => {
    expect(lineMatchesCategory('groceries', 'Eating out & delivery Living')).toBe(false);
    expect(billMatchesHint('groceries', 'Eating out & delivery Living')).toBe(false);
  });

  it('still matches each line to its own category', () => {
    expect(lineMatchesCategory('groceries', 'Groceries (home food) Living')).toBe(true);
    expect(lineMatchesCategory('dining', 'Eating out & delivery Living')).toBe(true);
  });

  it('does not let "home food" pull the grocery line into household', () => {
    // `household` matches a bare "home", which the renamed line now contains.
    expect(lineMatchesCategory('household', 'Groceries (home food) Living')).toBe(false);
  });

  it('ranks the eating-out line first for a delivery, and clearly', () => {
    /*
     * The Transport line still appears as a discounted runner-up, because
     * "UBER" genuinely is a transport brand — that is the runner-up rule
     * working, and it is what lets a delivery find a Transport line on a board
     * with no eating-out line at all.
     *
     * What matters is that it is not a TIE: before the self-word fix the two
     * food lines both scored 0.50 and the winner fell to board order.
     */
    const sms =
      'HNB SMS ALERT:INTERNET, Account:1380***6626,Location:UBER EATS, LK,Amount(Approx.):3497.91 LKR,Av.Bal:21427.48 LKR,Date:16.08.26,Time:01:29';
    const draft = reconcileSms(parseSms(sms)!, BOARD, 'd2');

    expect(draft.matches[0].subcategoryId).toBe('dine');
    // The grocery line must not be in the running at all.
    expect(draft.matches.map((m) => m.subcategoryId)).not.toContain('groc');
    expect(draft.matches[0].score).toBeGreaterThan(draft.matches[1]?.score ?? 0);
  });
});

describe('the catalog and onboarding', () => {
  it('offers both food lines', () => {
    const living = CATEGORY_CATALOG.find((cat) => cat.id === 'living')!;
    const ids = living.subcategories.map((sub) => sub.id);
    expect(ids).toContain('groceries');
    expect(ids).toContain('dining');
  });

  it('names them by where the food was eaten', () => {
    const living = CATEGORY_CATALOG.find((cat) => cat.id === 'living')!;
    const byId = (id: string) => living.subcategories.find((sub) => sub.id === id)!.name;
    expect(byId('groceries')).toMatch(/home food/i);
    expect(byId('dining')).toMatch(/eating out|delivery/i);
  });

  it('suggests eating out to everyone, not only people with a partner', () => {
    /*
     * It used to be gated on answering "partner", which assumed living alone
     * means cooking every meal — usually the opposite. The split also only
     * works when BOTH lines exist: whoever has no eating-out line files
     * restaurant food under Groceries and loses the comparison entirely.
     */
    const single = suggestedLines({ birthYear: 1998, household: [], transport: ['none'] });
    expect(single).toContain('groceries');
    expect(single).toContain('dining');
  });

  it('suggests both regardless of the answers given', () => {
    const skipped = suggestedLines({ birthYear: null, household: [], transport: [] });
    expect(skipped).toContain('groceries');
    expect(skipped).toContain('dining');
  });
});
