import { describe, expect, it } from 'vitest';
import { foreignCurrencyOf } from '~/features/accounts/logic/dualCurrency';
import { resolveSalaryCardId, type SalaryCardLike } from '../salaryAccount';

/**
 * Which currency the rate screens follow.
 *
 * The chain the app walks: find the salary account, then read the foreign
 * currency it holds. Only that one is fetched and shown — a board may hold
 * several, but the rate that matters is the one income ARRIVES in, because that
 * is what the board converts with.
 *
 * Captured from the user's real board: a DFCC account whose primary side is
 * LKR and whose foreign leg is USD, receiving a USD 2,500 salary, alongside
 * four purely local accounts.
 */

/** The chain, as the screen and the launch refresh both run it. */
function salaryCurrency(
  cards: readonly (SalaryCardLike & { currency?: string | null; foreignCurrency?: string | null })[],
  incomeLines: Parameters<typeof resolveSalaryCardId>[0]['incomeLines'],
  homeCurrency = 'LKR',
): string {
  const cardId = resolveSalaryCardId({ cards, incomeLines, homeCurrency });
  const card = cards.find((c) => c.id === cardId) ?? null;
  return foreignCurrencyOf(card, homeCurrency) ?? 'USD';
}

const REAL_BOARD: (SalaryCardLike & { foreignCurrency?: string | null })[] = [
  { id: 'hnb', bankId: 'hnb', currency: null },
  { id: 'dfcc', bankId: 'dfcc', currency: null, foreignCurrency: 'USD' },
  { id: 'nsb', bankId: 'nsb', currency: null },
  { id: 'ndb', bankId: 'ndb', currency: null },
];

const SALARY = [{ cardId: 'dfcc', amountMinor: 75_000_00, foreignAmount: 2500, isActive: true }];

describe('the currency the rate screen follows', () => {
  it('is the foreign leg of the salary account', () => {
    expect(salaryCurrency(REAL_BOARD, SALARY)).toBe('USD');
  });

  /**
   * The point of dropping the picker: another foreign account is irrelevant,
   * because it is not where the income lands.
   */
  it('ignores a foreign account the salary does not use', () => {
    const withEur = [...REAL_BOARD, { id: 'eur', bankId: 'commercial', currency: 'EUR' }];
    expect(salaryCurrency(withEur, SALARY)).toBe('USD');
  });

  it('follows a wholly foreign salary account', () => {
    const cards = [{ id: 'gbp', bankId: 'hsbc', currency: 'GBP' }];
    expect(
      salaryCurrency(cards, [{ cardId: 'gbp', amountMinor: 50_000_00, foreignAmount: 200, isActive: true }]),
    ).toBe('GBP');
  });

  /**
   * A projection must not decide the currency — the user's board holds a
   * larger "salary after raise" line that is deliberately inactive.
   */
  it('ignores an inactive projection', () => {
    const cards = [
      { id: 'usd', bankId: 'dfcc', currency: null, foreignCurrency: 'USD' },
      { id: 'eur', bankId: 'commercial', currency: 'EUR' },
    ];
    expect(
      salaryCurrency(cards, [
        { cardId: 'usd', amountMinor: 75_000_00, foreignAmount: 2500, isActive: true },
        { cardId: 'eur', amountMinor: 99_000_00, foreignAmount: 300, isActive: false },
      ]),
    ).toBe('USD');
  });

  /** A fresh board still opens on something real rather than an empty list. */
  it('falls back to USD with no foreign income at all', () => {
    expect(salaryCurrency([{ id: 'lkr', bankId: 'hnb', currency: 'LKR' }], [])).toBe('USD');
    expect(salaryCurrency([], [])).toBe('USD');
  });

  it('falls back to USD when the salary lands in a home-currency account', () => {
    const cards = [{ id: 'lkr', bankId: 'hnb', currency: null }];
    expect(
      salaryCurrency(cards, [{ cardId: 'lkr', amountMinor: 75_000_00, foreignAmount: null, isActive: true }]),
    ).toBe('USD');
  });
});
