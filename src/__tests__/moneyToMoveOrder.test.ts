import { describe, expect, it, vi } from 'vitest';

/*
 * Same stub as the other selector tests: the repositories reach for
 * expo-sqlite, which does not exist in node, and the only reads these
 * selectors make are per-period ones an unlogged board answers with nothing.
 */
vi.mock('~/db/repositories', () => ({
  stateRepo: { byPeriod: () => [] },
  transactionRepo: { bySubcategoryPeriod: () => [], houseTotalsByPeriod: () => new Map() },
}));

import { selectAccountTransfers } from '~/store/selectors';
import type { AppState } from '~/store/useAppStore';

/**
 * The order of "Money to move", while the user works down it.
 *
 * The bug: the list was sorted by what was LEFT to move, so ticking an account
 * dropped its figure to zero and slid the row to the bottom — the next account
 * jumped up into the spot the user was already reaching for, and they marked
 * the wrong one transferred. The order must not depend on anything a tick
 * changes.
 */

const PERIOD = '2026-09';
const now = new Date('2026-09-01');

const CARDS = [
  { id: 'card-small', nickname: 'Small', bankName: 'A' },
  { id: 'card-big', nickname: 'Big', bankName: 'B' },
  { id: 'card-mid', nickname: 'Mid', bankName: 'C' },
];

const LINES = [
  { id: 'l-small', categoryId: 'cat', cardId: 'card-small', plannedMinor: 5_000_00 },
  { id: 'l-big', categoryId: 'cat', cardId: 'card-big', plannedMinor: 90_000_00 },
  { id: 'l-mid', categoryId: 'cat', cardId: 'card-mid', plannedMinor: 40_000_00 },
];

function buildState(transferred: string[] = []): AppState {
  return {
    period: PERIOD,
    currency: 'LKR',
    rates: {},
    cards: CARDS.map((c) => ({
      ...c,
      bankId: null,
      isCard: false,
      currency: null,
      openingBalanceMinor: 0,
      targetMinor: null,
      color: '#000000',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })),
    categories: [
      {
        id: 'cat',
        name: 'Living',
        cardId: null,
        color: '#000000',
        icon: 'albums-outline',
        dueDay: null,
        defaultFrequency: 'monthly',
        sortOrder: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    subcategories: LINES.map((l, i) => ({
      ...l,
      name: l.id,
      type: 'expense',
      frequency: 'monthly',
      dueDay: 1,
      icon: 'pricetag-outline',
      color: '#000000',
      loanId: null,
      onceInPeriod: null,
      planTargetMinor: null,
      planDueDate: null,
      planStartDate: null,
      planRemindDaysBefore: null,
      houseScoped: false,
      houseId: null,
      sortOrder: i,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })),
    states: new Map(),
    categoryStates: new Map(),
    transactionTotals: new Map(),
    fundingTotals: new Map(),
    houses: [],
    houseTotals: new Map(),
    incomes: [],
    loans: [],
    smsDrafts: [],
    accountTransferStates: new Map(
      transferred.map((cardId) => [
        cardId,
        { cardId, period: PERIOD, status: 'transferred', matchedAmountMinor: null },
      ]),
    ),
  } as unknown as AppState;
}

const order = (state: AppState) =>
  selectAccountTransfers(state).map((row) => row.card.id);

describe('the order of the accounts list', () => {
  it('is by planned amount, biggest first', () => {
    expect(order(buildState())).toEqual(['card-big', 'card-mid', 'card-small']);
  });

  it('does NOT move a row when that account is marked transferred', () => {
    // The exact bug: ticking the top account used to send it to the bottom.
    const before = order(buildState());
    expect(order(buildState(['card-big']))).toEqual(before);
  });

  it('stays put however many are ticked, and in any order', () => {
    const before = order(buildState());
    expect(order(buildState(['card-mid']))).toEqual(before);
    expect(order(buildState(['card-mid', 'card-small']))).toEqual(before);
    expect(order(buildState(['card-big', 'card-mid', 'card-small']))).toEqual(before);
  });

  it('still reports the money itself moving', () => {
    // Order is frozen, but the figures must still respond to the tick.
    const rows = selectAccountTransfers(buildState(['card-big']));
    const big = rows.find((r) => r.card.id === 'card-big')!;
    expect(big.toTransferMinor).toBe(0);
    expect(big.movedMinor).toBe(90_000_00);
    // An untouched account is unaffected.
    expect(rows.find((r) => r.card.id === 'card-mid')!.toTransferMinor).toBe(40_000_00);
  });

  it('is deterministic when two accounts plan the same amount', () => {
    // Without a tiebreak the order could differ between renders, which is the
    // same jumping-row problem by another route.
    const tied = buildState();
    expect(order(tied)).toEqual(order(tied));
  });
});
