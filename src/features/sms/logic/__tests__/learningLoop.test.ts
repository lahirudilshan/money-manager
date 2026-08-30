import { describe, expect, it } from 'vitest';
import { extractSmsFromUrl } from '../smsIntakeUrl';
import { parseSms } from '../smsParser';
import { reconcileSms, type BoardSlice } from '../smsReconcile';
import { matchMerchant, planRuleUpsert, type MerchantRule } from '../merchantRules';

/**
 * End-to-end proof of the feature the user asked for: an unknown shop is asked
 * about once, and is auto-detected from then on.
 *
 * This walks the real pipeline — deep link -> parse -> reconcile -> user
 * resolves -> rule written -> next message matches — with an in-memory stand-in
 * for the rules table, so the pieces are verified as a system rather than
 * individually.
 */
const board: BoardSlice = {
  cards: [{ id: 'card1', nickname: null, last4: '1234', bankName: 'HNB' }],
  categories: [{ id: 'cat_food', name: 'Food', cardId: 'card1' }],
  subcategories: [
    {
      id: 'sub_groceries',
      name: 'Groceries',
      type: 'expense',
      plannedMinor: 5_000_000,
      categoryId: 'cat_food',
      cardId: null,
      loanId: null,
    },
  ],
};

/** The store's confirm step, reduced to its rule-table effect. */
function applyLearning(rules: MerchantRule[], merchant: string, subcategoryId: string) {
  const plan = planRuleUpsert(merchant, subcategoryId, null, rules);
  if (!plan) return rules;
  if (plan.kind === 'insert') {
    return [
      ...rules,
      {
        id: `r${rules.length}`,
        pattern: plan.pattern,
        subcategoryId: plan.subcategoryId,
        hint: plan.hint,
        source: 'learned' as const,
        hitCount: 1,
        updatedAt: Date.now(),
      },
    ];
  }
  return rules.map((r) =>
    r.id === plan.id
      ? { ...r, subcategoryId: plan.subcategoryId, hitCount: r.hitCount + 1, updatedAt: Date.now() }
      : r,
  );
}

const smsFor = (merchant: string) =>
  `LKR 4,500.00 debited from AC XXXXXXXX1234 as POS TXN on 20 Jul 2026 at ${merchant}. Avl Bal 1,000.00`;

describe('the learning loop, end to end', () => {
  it('asks once about an unknown shop, then detects it automatically', () => {
    let rules: MerchantRule[] = [];

    // 1. First message from a shop the app has never seen.
    const first = extractSmsFromUrl(`moneymanager://sms?text=${smsFor('F L I TRADING')}`)!;
    const firstDraft = reconcileSms(parseSms(first)!, board, 'd1', rules);

    expect(firstDraft.confidence).toBe('unknown');
    expect(firstDraft.subcategoryId).toBe('');

    // 2. The user picks the right line — this is the teaching moment.
    rules = applyLearning(rules, firstDraft.parsed.merchant, 'sub_groceries');
    expect(rules).toHaveLength(1);

    // 3. The same shop next month is now recognised outright.
    const second = extractSmsFromUrl(`moneymanager://sms?text=${smsFor('F L I TRADING')}`)!;
    const secondDraft = reconcileSms(parseSms(second)!, board, 'd2', rules);

    expect(secondDraft.confidence).toBe('exact');
    expect(secondDraft.subcategoryId).toBe('sub_groceries');
  });

  it('recognises the shop even when the bank spells it differently', () => {
    let rules = applyLearning([], 'F L I TRADING', 'sub_groceries');
    // Same merchant, un-spaced spelling — must hit the same learned rule.
    const draft = reconcileSms(parseSms(smsFor('FLI Trading'))!, board, 'd3', rules);
    expect(draft.subcategoryId).toBe('sub_groceries');
  });

  it('gets more confident each time the guess is confirmed', () => {
    let rules = applyLearning([], 'FLI TRADING', 'sub_groceries');
    rules = applyLearning(rules, 'FLI TRADING', 'sub_groceries');
    expect(rules).toHaveLength(1);
    expect(rules[0].hitCount).toBe(2);
  });

  it('corrects itself when the user says the category was wrong', () => {
    const wider: BoardSlice = {
      ...board,
      subcategories: [
        ...board.subcategories,
        {
          id: 'sub_fuel',
          name: 'Fuel',
          type: 'expense',
          plannedMinor: 3_000_000,
          categoryId: 'cat_food',
          cardId: null,
          loanId: null,
        },
      ],
    };

    let rules = applyLearning([], 'FLI TRADING', 'sub_groceries');
    // The user opens it and says "wrong category", choosing Fuel instead.
    rules = applyLearning(rules, 'FLI TRADING', 'sub_fuel');

    expect(rules).toHaveLength(1);
    expect(matchMerchant('FLI TRADING', rules).subcategoryId).toBe('sub_fuel');

    const draft = reconcileSms(parseSms(smsFor('FLI TRADING'))!, wider, 'd4', rules);
    expect(draft.subcategoryId).toBe('sub_fuel');
  });
});
