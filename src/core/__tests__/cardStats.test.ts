import { describe, expect, it } from 'vitest';
import { resolveCardId } from '../planning';
import { toMinor } from '../money';

/**
 * The card statistics, reproduced exactly as `selectCardViews` derives them.
 *
 * These figures are money the user reconciles against a real bank app, so the
 * two rules that were wrong are pinned here:
 *   - a balance is money in MINUS money out (paying a bill must reduce it);
 *   - an income line is neither a bill to pay nor a deduction.
 */
interface Line {
  id: string;
  type: 'income' | 'expense';
  amountMinor: number;
  status: 'pending' | 'paid';
  cardId: string | null;
}

function cardStats(
  card: { id: string; openingBalanceMinor: number },
  categoryCardId: string | null,
  lines: Line[],
  fundedIn: number,
) {
  let committed = 0;
  let spent = 0;
  for (const line of lines) {
    if (resolveCardId(line.cardId, categoryCardId) !== card.id) continue;
    if (line.type === 'income') continue;
    if (line.status === 'paid') spent += line.amountMinor;
    else committed += line.amountMinor;
  }
  return {
    balanceMinor: card.openingBalanceMinor + fundedIn - spent,
    spentMinor: spent,
    committedMinor: committed,
  };
}

const card = { id: 'c1', openingBalanceMinor: toMinor(10_000) };
const line = (p: Partial<Line> & { id: string }): Line => ({
  type: 'expense',
  amountMinor: toMinor(1_000),
  status: 'pending',
  cardId: null,
  ...p,
});

describe('card statistics', () => {
  it('deducts paid bills from the balance', () => {
    const stats = cardStats(card, 'c1', [line({ id: 'rent', amountMinor: toMinor(50_000), status: 'paid' })], toMinor(85_000));
    // 10,000 opening + 85,000 funded - 50,000 paid.
    expect(stats.balanceMinor).toBe(toMinor(45_000));
  });

  it('does not deduct a bill that is still pending', () => {
    const stats = cardStats(card, 'c1', [line({ id: 'rent', amountMinor: toMinor(50_000) })], toMinor(85_000));
    expect(stats.balanceMinor).toBe(toMinor(95_000));
    expect(stats.committedMinor).toBe(toMinor(50_000));
  });

  it('keeps income out of "still to pay"', () => {
    const stats = cardStats(
      card,
      'c1',
      [
        line({ id: 'salary', type: 'income', amountMinor: toMinor(300_000) }),
        line({ id: 'food', amountMinor: toMinor(35_000) }),
      ],
      0,
    );
    expect(stats.committedMinor).toBe(toMinor(35_000));
  });

  it('never lets income change the balance', () => {
    const withIncome = cardStats(card, 'c1', [line({ id: 's', type: 'income', amountMinor: toMinor(300_000), status: 'paid' })], 0);
    expect(withIncome.balanceMinor).toBe(card.openingBalanceMinor);
  });

  it('lets a balance go negative when spending exceeds funding', () => {
    const stats = cardStats(card, 'c1', [line({ id: 'big', amountMinor: toMinor(60_000), status: 'paid' })], 0);
    // 10,000 opening - 60,000 paid = -50,000; overspend must be visible.
    expect(stats.balanceMinor).toBe(toMinor(-50_000));
  });

  it('respects a per-line card override', () => {
    const stats = cardStats(
      card,
      'other',
      [line({ id: 'moved', amountMinor: toMinor(5_000), status: 'paid', cardId: 'c1' })],
      0,
    );
    expect(stats.spentMinor).toBe(toMinor(5_000));
  });

  it('ignores lines belonging to another card', () => {
    const stats = cardStats(card, 'other', [line({ id: 'elsewhere', status: 'paid' })], 0);
    expect(stats.spentMinor).toBe(0);
    expect(stats.balanceMinor).toBe(card.openingBalanceMinor);
  });

  it('reconciles: opening + funded - spent = balance', () => {
    const stats = cardStats(
      card,
      'c1',
      [
        line({ id: 'a', amountMinor: toMinor(20_000), status: 'paid' }),
        line({ id: 'b', amountMinor: toMinor(15_000), status: 'paid' }),
        line({ id: 'c', amountMinor: toMinor(9_000) }),
      ],
      toMinor(50_000),
    );
    expect(stats.spentMinor).toBe(toMinor(35_000));
    expect(stats.committedMinor).toBe(toMinor(9_000));
    expect(card.openingBalanceMinor + toMinor(50_000) - stats.spentMinor).toBe(stats.balanceMinor);
  });
});
