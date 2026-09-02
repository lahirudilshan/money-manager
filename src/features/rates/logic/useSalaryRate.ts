/**
 * The salary bank's rate, wherever a screen needs it.
 *
 * Three places now ask the same question — the dashboard's "money to move",
 * the Settings currency sheet, and the rates screen itself — and each was
 * resolving it from scratch: read the cache, resolve the salary account, join
 * to a bank, find the row. Four steps, and any screen that got one of them
 * subtly different would quietly show a different rate from its neighbours.
 *
 * Reading from the settings cache rather than the network, so it is synchronous
 * and cannot make a screen wait. The cache is refreshed in the background at
 * launch (see `refreshBankRates`), which is what keeps it current.
 */

import { useMemo } from 'react';
import { settingsRepo, SETTINGS_KEYS } from '~/db/repositories';
import {
  rateForBank,
  resolveBankRates,
  sortByBuying,
  type BankRate,
  type ResolvedBankRate,
} from './bankRates';
import { resolveSalaryCardId, salaryBankId, type IncomeLineLike, type SalaryCardLike } from './salaryAccount';

export interface SalaryRate {
  /** The salary bank's row, or null when it is unknown or unpublished. */
  rate: ResolvedBankRate | null;
  /** Every bank's rate, best-paying first. */
  all: ResolvedBankRate[];
  /** The resolved salary bank id, even when that bank published no rate. */
  bankId: string | null;
}

/**
 * `rates` comes from STORE state (`useAppStore().bankRates`), not from the
 * settings row directly. The launch refresh writes the cache after the
 * dashboard has mounted, and reading the row here would leave the dollar
 * figure blank until the next cold start — nothing would announce the change.
 */
export function useSalaryRate(options: {
  cards: readonly SalaryCardLike[];
  incomes: readonly IncomeLineLike[];
  homeCurrency: string;
  rates: readonly BankRate[];
}): SalaryRate {
  const { cards, incomes, homeCurrency, rates } = options;

  return useMemo(() => {
    const all = sortByBuying(resolveBankRates(rates));

    const cardId = resolveSalaryCardId({
      cards,
      incomeLines: incomes,
      chosenCardId: settingsRepo.get(SETTINGS_KEYS.salaryCardId),
      homeCurrency,
    });
    const bankId = salaryBankId(cards, cardId);

    return { rate: rateForBank(all, bankId), all, bankId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, incomes, homeCurrency, rates]);
}

/**
 * The salary bank's rate, from a plain store snapshot rather than a hook.
 *
 * The launch sequence needs this outside React — it runs in a promise callback
 * after the database is ready, where no component is rendering and hooks
 * cannot be called. Same resolution as `useSalaryRate`, so the figure the app
 * adopts is the one every screen goes on to show.
 */
export function salaryBankRate(state: {
  cards: readonly SalaryCardLike[];
  incomes: readonly IncomeLineLike[];
  currency: string;
  bankRates: readonly BankRate[];
}): number | null {
  const all = sortByBuying(resolveBankRates(state.bankRates));

  const cardId = resolveSalaryCardId({
    cards: state.cards,
    incomeLines: state.incomes,
    chosenCardId: settingsRepo.get(SETTINGS_KEYS.salaryCardId),
    homeCurrency: state.currency,
  });

  return rateForBank(all, salaryBankId(state.cards, cardId))?.ttBuying ?? null;
}
