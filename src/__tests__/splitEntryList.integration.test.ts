import { describe, expect, it, vi } from 'vitest';

/**
 * The entry list on a budget line, when a payment was split.
 *
 * The board has always counted splits correctly — `transactionRepo.totalsByPeriod`
 * unions unsplit transactions with the PARTS of split ones. The subcategory
 * screen did not: it summed the raw transaction rows, so a 73,000 transfer split
 * 53,000 groceries / 20,000 Samadhi still read as "LKR 73,000 spent" on
 * groceries, and never appeared on Samadhi at all. Two screens, two answers,
 * from the same database.
 *
 * These pin the screen to the board's rule.
 */

const GROCERIES = 'sub-groceries';
const SAMADHI = 'sub-samadhi';
const PERIOD = '2026-09';

/** The 73,000 transfer, recorded against groceries and split two ways. */
const transfer = {
  id: 'txn-transfer',
  subcategoryId: GROCERIES,
  period: PERIOD,
  name: 'Outward CEFT Transfer',
  amountMinor: 73_000_00,
  date: new Date('2026-09-03'),
  note: null,
  imageUri: null,
};

/** An ordinary unsplit entry on the same line, to prove it still counts whole. */
const milk = {
  id: 'txn-milk',
  subcategoryId: GROCERIES,
  period: PERIOD,
  name: 'Milk',
  amountMinor: 1_200_00,
  date: new Date('2026-09-05'),
  note: null,
  imageUri: null,
};

const splits = [
  {
    id: 's1',
    transactionId: 'txn-transfer',
    subcategoryId: GROCERIES,
    amountMinor: 53_000_00,
    note: null,
    sortOrder: 0,
  },
  {
    id: 's2',
    transactionId: 'txn-transfer',
    subcategoryId: SAMADHI,
    amountMinor: 20_000_00,
    note: null,
    sortOrder: 1,
  },
];

vi.mock('~/db/repositories', () => ({
  stateRepo: { byPeriod: () => [] },
  transactionRepo: {
    // Rows whose own `subcategory_id` points at the line.
    bySubcategoryPeriod: (subcategoryId: string) =>
      subcategoryId === GROCERIES ? [transfer, milk] : [],
    // Payments living on another line but split ONTO this one.
    splitOntoSubcategoryPeriod: (subcategoryId: string) =>
      subcategoryId === SAMADHI ? [transfer] : [],
  },
  transactionSplitRepo: {
    byTransactions: (ids: readonly string[]) =>
      new Map(ids.includes('txn-transfer') ? [['txn-transfer', splits]] : []),
  },
}));

import { selectTransactionEntries } from '~/store/selectors';
import type { AppState } from '~/store/useAppStore';

const state = { period: PERIOD } as AppState;

const sum = (subcategoryId: string) =>
  selectTransactionEntries(state, subcategoryId).reduce((t, e) => t + e.shareMinor, 0);

describe('the entry list of a split payment', () => {
  it('charges the origin line its part, not the whole payment', () => {
    // The exact bug: this read 73,000 + 1,200 before.
    expect(sum(GROCERIES)).toBe(53_000_00 + 1_200_00);
  });

  it('shows the payment on the line it was split ONTO', () => {
    // Samadhi owns no transaction row at all — only a part.
    const entries = selectTransactionEntries(state, SAMADHI);
    expect(entries).toHaveLength(1);
    expect(entries[0].txn.id).toBe('txn-transfer');
    expect(entries[0].shareMinor).toBe(20_000_00);
  });

  it('keeps the payment itself whole, so the editor can rebalance it', () => {
    // `shareMinor` must never be written back over the real amount: reopening
    // the split editor against 53,000 would make the parts fail to balance.
    const [entry] = selectTransactionEntries(state, SAMADHI);
    expect(entry.txn.amountMinor).toBe(73_000_00);
  });

  it('counts an unsplit entry whole', () => {
    const entry = selectTransactionEntries(state, GROCERIES).find((e) => e.txn.id === 'txn-milk');
    expect(entry?.shareMinor).toBe(1_200_00);
    expect(entry?.splits).toEqual([]);
  });

  it('splits the payment across lines without inventing or losing money', () => {
    // The invariant that makes splitting safe: distribution moves, total does not.
    expect(sum(GROCERIES) + sum(SAMADHI)).toBe(73_000_00 + 1_200_00);
  });

  it('carries the parts so a row can say what it came from', () => {
    const [entry] = selectTransactionEntries(state, SAMADHI);
    expect(entry.splits).toHaveLength(2);
  });
});
