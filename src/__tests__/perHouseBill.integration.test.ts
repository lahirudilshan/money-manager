import './harness/nativeMocks';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A per-house bill (Water, on a board with more than one house) records each
 * payment as an entry. Ticking it paid with no figure typed stored LKR 0 — the
 * bill read "paid" while no money moved — and saving it pending added an entry.
 */
let store: typeof import('~/store/useAppStore');
let repos: typeof import('~/db/repositories');
const S = () => store.useAppStore.getState();
let waterId = '';

beforeAll(async () => {
  (await import('~/db/client')).initialiseDatabase();
  store = await import('~/store/useAppStore');
  repos = await import('~/db/repositories');
  S().refresh();
  S().addHouse({ name: 'Home', isPrimary: true } as never);
  S().addHouse({ name: 'Parents', isPrimary: false } as never);
  const card = S().addCard({ nickname: 'Bank', bankId: 'boc', isCard: false, sortOrder: 0 } as never);
  const cat = S().addCategory({ name: 'Housing', cardId: card.id, icon: 'home-outline', dueDay: 1 } as never);
  S().addSubcategory({ name: 'Water', categoryId: cat.id, plannedMinor: 250_000, frequency: 'monthly', houseScoped: true } as never);
  waterId = S().subcategories.find((s) => s.name === 'Water')!.id;
});

const entries = () => repos.transactionRepo.bySubcategoryPeriod(waterId, S().period);

describe('ticking a per-house bill', () => {
  it('saving it still pending records no payment', () => {
    S().logTransaction(waterId, { status: 'pending', actualMinor: null });
    expect(entries()).toHaveLength(0);
  });

  it('paid with no figure typed records the planned amount, not zero', () => {
    S().logTransaction(waterId, { status: 'paid', actualMinor: null });
    expect(entries().map((t) => t.amountMinor)).toEqual([250_000]);
  });

  it('saving the paid bill again is not a second payment', () => {
    S().logTransaction(waterId, { status: 'paid', actualMinor: null });
    expect(entries()).toHaveLength(1);
  });

  it('a second payment with its own figure is recorded', () => {
    S().logTransaction(waterId, { status: 'paid', actualMinor: 90_000 });
    expect(entries().map((t) => t.amountMinor).sort((a, b) => a - b)).toEqual([90_000, 250_000]);
  });
});
