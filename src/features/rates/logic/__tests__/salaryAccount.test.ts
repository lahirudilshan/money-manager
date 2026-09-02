import { describe, expect, it } from 'vitest';
import { resolveSalaryCardId, salaryBankId, type SalaryCardLike } from '../salaryAccount';

const cards: SalaryCardLike[] = [
  { id: 'lkr', bankId: 'commercial', currency: 'LKR' },
  { id: 'usd', bankId: 'hnb', currency: 'USD' },
  { id: 'legacy', bankId: 'boc', currency: null },
];

const base = { cards, homeCurrency: 'LKR' };

describe('resolveSalaryCardId', () => {
  it('prefers the explicit choice over anything inferred', () => {
    expect(resolveSalaryCardId({ ...base, incomeLines: [], chosenCardId: 'lkr' })).toBe('lkr');
  });

  it('ignores a stale choice pointing at a deleted card', () => {
    expect(resolveSalaryCardId({ ...base, incomeLines: [], chosenCardId: 'deleted' })).toBe('usd');
  });

  /**
   * The real-world case, and the one an earlier version got wrong.
   *
   * A USD salary is wired into an ORDINARY LOCAL account and converted on
   * arrival, so the account's currency says nothing. `foreignAmount` on the
   * income is what marks it as dollar-paid.
   */
  it('follows a foreign-paid income into a local account', () => {
    expect(
      resolveSalaryCardId({
        cards: [{ id: 'local', bankId: 'dfcc', currency: null }],
        homeCurrency: 'LKR',
        incomeLines: [{ cardId: 'local', amountMinor: 75_000_000, foreignAmount: 2500 }],
      }),
    ).toBe('local');
  });

  /**
   * Captured from the real device database: two salary lines on the same
   * account, the larger one INACTIVE because it is a projection.
   */
  it('ignores an inactive projection, even when it is the larger figure', () => {
    expect(
      resolveSalaryCardId({
        cards: [{ id: 'plan_card_ndb', bankId: 'dfcc', currency: null }],
        homeCurrency: 'LKR',
        incomeLines: [
          { cardId: 'plan_card_ndb', amountMinor: 75_000_000, foreignAmount: 2500, isActive: true },
          { cardId: 'plan_card_ndb', amountMinor: 83_000_000, foreignAmount: null, isActive: false },
        ],
      }),
    ).toBe('plan_card_ndb');
  });

  it('picks the largest foreign-paid income when several exist', () => {
    expect(
      resolveSalaryCardId({
        cards: [
          { id: 'a', bankId: 'hnb', currency: null },
          { id: 'b', bankId: 'sampath', currency: null },
        ],
        homeCurrency: 'LKR',
        incomeLines: [
          { cardId: 'b', amountMinor: 5_000_000, foreignAmount: 150 },
          { cardId: 'a', amountMinor: 75_000_000, foreignAmount: 2500 },
        ],
      }),
    ).toBe('a');
  });

  it('ignores a purely local income with no foreign figure', () => {
    expect(
      resolveSalaryCardId({
        cards: [{ id: 'local', bankId: 'dfcc', currency: null }],
        homeCurrency: 'LKR',
        incomeLines: [{ cardId: 'local', amountMinor: 75_000_000, foreignAmount: null }],
      }),
    ).toBeNull();
  });

  it('ignores a foreign income pointing at a card that no longer exists', () => {
    expect(
      resolveSalaryCardId({
        cards: [{ id: 'local', bankId: 'dfcc', currency: null }],
        homeCurrency: 'LKR',
        incomeLines: [{ cardId: 'deleted', amountMinor: 75_000_000, foreignAmount: 2500 }],
      }),
    ).toBeNull();
  });

  it('falls back to a genuine foreign-currency account', () => {
    expect(resolveSalaryCardId({ ...base, incomeLines: [] })).toBe('usd');
  });

  it('gives up rather than guessing between two foreign accounts', () => {
    const many: SalaryCardLike[] = [
      { id: 'usd', bankId: 'hnb', currency: 'USD' },
      { id: 'gbp', bankId: 'hsbc', currency: 'GBP' },
    ];
    expect(resolveSalaryCardId({ cards: many, homeCurrency: 'LKR', incomeLines: [] })).toBeNull();
  });

  it('returns null when every account is in the home currency', () => {
    const local: SalaryCardLike[] = [{ id: 'lkr', bankId: 'commercial', currency: 'LKR' }];
    expect(resolveSalaryCardId({ cards: local, homeCurrency: 'LKR', incomeLines: [] })).toBeNull();
  });

  /** A null currency is a pre-migration row, which means the home currency. */
  it('does not treat a legacy null-currency account as foreign', () => {
    const legacy: SalaryCardLike[] = [{ id: 'legacy', bankId: 'boc', currency: null }];
    expect(resolveSalaryCardId({ cards: legacy, homeCurrency: 'LKR', incomeLines: [] })).toBeNull();
  });
});

describe('salaryBankId', () => {
  it('reads the bank behind the resolved account', () => {
    expect(salaryBankId(cards, 'usd')).toBe('hnb');
  });

  it('is null when no salary account is known', () => {
    expect(salaryBankId(cards, null)).toBeNull();
  });

  /**
   * The device's "Salary" card is nicknamed for NDB but its bank_id is dfcc.
   * The bank_id is what the rate must join on — the nickname is decoration.
   */
  it('uses bank_id, not the account nickname', () => {
    const real: SalaryCardLike[] = [{ id: 'plan_card_ndb', bankId: 'dfcc', currency: null }];
    expect(salaryBankId(real, 'plan_card_ndb')).toBe('dfcc');
  });
});
