import { describe, expect, it } from 'vitest';
import {
  buildLedgers,
  monthlyPlanOf,
  openingForTarget,
  periodFlow,
  periodsBetween,
  plannedForAccount,
  resolveSourceCardId,
  type LedgerInput,
  type LedgerLine,
} from '../accountLedger';

const created = new Date('2026-01-05');

function line(partial: Partial<LedgerLine> & Pick<LedgerLine, 'id' | 'cardId'>): LedgerLine {
  return {
    name: partial.id,
    type: 'expense',
    frequency: 'monthly',
    plannedMinor: 0,
    planTargetMinor: null,
    onceInPeriod: null,
    createdAt: created,
    ...partial,
  };
}

const identity = (minor: number) => minor;

function input(partial: Partial<LedgerInput>): LedgerInput {
  return {
    accounts: [],
    lines: [],
    states: [],
    transactions: [],
    transfers: [],
    incomes: [],
    sourceCardId: null,
    currentPeriod: '2026-10',
    toAccount: identity,
    toHome: identity,
    ...partial,
  };
}

describe('monthlyPlanOf', () => {
  it('asks for a one-time cost only in its own month', () => {
    const repair = line({ id: 'r', cardId: 'a', frequency: 'one_time', plannedMinor: 3000, onceInPeriod: '2026-08' });
    expect(monthlyPlanOf(repair, '2026-08')).toBe(3000);
    expect(monthlyPlanOf(repair, '2026-09')).toBe(0);
  });

  it('spreads a plain yearly bill, but not a saving plan that is already monthly', () => {
    const licence = line({ id: 'l', cardId: 'a', frequency: 'yearly', plannedMinor: 12_000 });
    const insurance = line({ id: 'i', cardId: 'a', frequency: 'yearly', plannedMinor: 1_200, planTargetMinor: 14_400 });
    expect(monthlyPlanOf(licence, '2026-09')).toBe(1_000);
    expect(monthlyPlanOf(insurance, '2026-09')).toBe(1_200);
  });

  it('never asks an account to fund income', () => {
    const lines = [
      line({ id: 'rent', cardId: 'a', plannedMinor: 500 }),
      line({ id: 'pay', cardId: 'a', plannedMinor: 9_000, type: 'income' }),
    ];
    expect(plannedForAccount(lines, 'a', '2026-09')).toBe(500);
  });
});

describe('periodsBetween', () => {
  it('walks across a year boundary', () => {
    expect(periodsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(periodsBetween('2026-11', '2026-10')).toEqual([]);
  });
});

describe('resolveSourceCardId', () => {
  it('prefers an explicit pick, then the account the most income lands in', () => {
    const incomes = [
      { id: '1', name: 'Salary', amountMinor: 100, cardId: 'a', isActive: true },
      { id: '2', name: 'Rent in', amountMinor: 40, cardId: 'b', isActive: true },
      { id: '3', name: 'Raise', amountMinor: 900, cardId: 'b', isActive: false },
    ];
    expect(resolveSourceCardId({ accountIds: ['a', 'b'], incomes, incomeLines: [] })).toBe('a');
    expect(resolveSourceCardId({ accountIds: ['a', 'b'], incomes, incomeLines: [], chosenCardId: 'b' })).toBe('b');
    // A pick pointing at a deleted account is ignored.
    expect(resolveSourceCardId({ accountIds: ['a', 'b'], incomes, incomeLines: [], chosenCardId: 'gone' })).toBe('a');
    expect(resolveSourceCardId({ accountIds: ['a'], incomes: [], incomeLines: [] })).toBeNull();
  });
});

describe('buildLedgers', () => {
  const accounts = [
    { id: 'pay', openingBalanceMinor: 1_000, startPeriod: '2026-09' },
    { id: 'usd', openingBalanceMinor: 50, startPeriod: '2026-09' },
  ];

  it('converts plans into a foreign account’s own currency, and back out of the source', () => {
    // 1 USD = 300 home units.
    const toAccount = (minor: number, id: string) => (id === 'usd' ? Math.round(minor / 300) : minor);
    const toHome = (minor: number, id: string) => (id === 'usd' ? minor * 300 : minor);
    const ledgers = buildLedgers(
      input({
        accounts,
        lines: [line({ id: 'school', cardId: 'usd', plannedMinor: 30_000 })],
        transfers: [
          { cardId: 'usd', period: '2026-09', status: 'transferred', amountMinor: null, matchedAmountMinor: null, transferredAt: null },
        ],
        sourceCardId: 'pay',
        toAccount,
        toHome,
      }),
    );
    // Legacy row with no stored amount: the plan, converted — 100 USD.
    expect(ledgers.get('usd')!.balanceMinor).toBe(50 + 100);
    // The source loses the same money in ITS currency.
    expect(ledgers.get('pay')!.balanceMinor).toBe(1_000 - 30_000);
  });

  it('debits nobody when there is no known source account', () => {
    const ledgers = buildLedgers(
      input({
        accounts,
        transfers: [
          { cardId: 'usd', period: '2026-09', status: 'transferred', amountMinor: 20, matchedAmountMinor: null, transferredAt: null },
        ],
      }),
    );
    expect(ledgers.get('usd')!.balanceMinor).toBe(70);
    expect(ledgers.get('pay')!.balanceMinor).toBe(1_000);
  });

  it('ignores what happened before tracking began and what has not happened yet', () => {
    const groceries = line({ id: 'g', cardId: 'pay', frequency: 'ongoing' });
    const at = (period: string) => ({
      id: period,
      subcategoryId: 'g',
      period,
      name: 'shop',
      amountMinor: 10,
      date: new Date(`${period}-02`),
    });
    const ledgers = buildLedgers(
      input({ accounts, lines: [groceries], transactions: [at('2026-08'), at('2026-09'), at('2026-11')] }),
    );
    expect(ledgers.get('pay')!.balanceMinor).toBe(990);
  });

  it('values a bill ticked with no figure at what it cost then, not the plan today', () => {
    const rent = line({ id: 'rent', cardId: 'pay', plannedMinor: 700 });
    const states = [
      { subcategoryId: 'rent', period: '2026-09', status: 'paid', actualMinor: null, paidAmountMinor: 500 },
      // A row from before the frozen amount existed falls back to the plan.
      { subcategoryId: 'rent', period: '2026-10', status: 'completed', actualMinor: null },
    ];
    const ledgers = buildLedgers(input({ accounts, lines: [rent], states }));
    expect(ledgers.get('pay')!.balanceMinor).toBe(1_000 - 500 - 700);
  });

  it('lets an entry stand in for the month’s tick rather than counting both', () => {
    const power = line({ id: 'p', cardId: 'pay', plannedMinor: 90 });
    const ledgers = buildLedgers(
      input({
        accounts,
        lines: [power],
        states: [{ subcategoryId: 'p', period: '2026-09', status: 'paid', actualMinor: null, paidAmountMinor: 90 }],
        transactions: [{ id: 't', subcategoryId: 'p', period: '2026-09', name: 'CEB', amountMinor: 84, date: new Date('2026-09-04') }],
      }),
    );
    expect(ledgers.get('pay')!.balanceMinor).toBe(1_000 - 84);
  });

  it('counts declared salary in finished months, and this month only once money moves', () => {
    const base = input({
      accounts,
      incomes: [{ id: 's', name: 'Salary', amountMinor: 500, cardId: 'pay', isActive: true }],
      sourceCardId: 'pay',
    });
    // September (finished) counted; October not yet.
    expect(buildLedgers(base).get('pay')!.balanceMinor).toBe(1_500);
    const moved = buildLedgers({
      ...base,
      transfers: [{ cardId: 'usd', period: '2026-10', status: 'transferred', amountMinor: 1, matchedAmountMinor: null, transferredAt: null }],
    });
    expect(moved.get('pay')!.balanceMinor).toBe(2_000 - 1);
  });

  it('does not count a salary twice when it is also a board income line', () => {
    const ledgers = buildLedgers(
      input({
        accounts,
        lines: [line({ id: 'sal', name: 'Salary', cardId: 'pay', type: 'income', plannedMinor: 500 })],
        incomes: [{ id: 's', name: 'Salary', amountMinor: 500, cardId: 'pay', isActive: true }],
        states: [{ subcategoryId: 'sal', period: '2026-09', status: 'paid', actualMinor: null }],
      }),
    );
    expect(ledgers.get('pay')!.balanceMinor).toBe(1_500);
  });
});

describe('periodFlow and openingForTarget', () => {
  it('reads a month as a statement and back-solves an opening from today', () => {
    const groceries = line({ id: 'g', cardId: 'pay', frequency: 'ongoing' });
    const accounts = [{ id: 'pay', openingBalanceMinor: 100, startPeriod: '2026-09' }];
    const txn = (period: string, amount: number) => ({
      id: `${period}${amount}`,
      subcategoryId: 'g',
      period,
      name: 'x',
      amountMinor: amount,
      date: new Date(`${period}-03`),
    });
    const ledger = buildLedgers(
      input({ accounts, lines: [groceries], transactions: [txn('2026-09', 30), txn('2026-10', 20)] }),
    ).get('pay')!;

    expect(periodFlow(ledger, '2026-09')).toMatchObject({ openingMinor: 100, outMinor: 30, closingMinor: 70 });
    expect(periodFlow(ledger, '2026-10')).toMatchObject({ openingMinor: 70, outMinor: 20, closingMinor: 50 });
    // The bank says 80 today: the opening must have been 130.
    expect(openingForTarget(ledger, 100, 80)).toBe(130);
  });
});
