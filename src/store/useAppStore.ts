import { create } from 'zustand';
import { buildSchedule, paymentsElapsed, remainingBalance } from '../core/amortization';
import { sumMinor, type Minor } from '../core/money';
import {
  calculateRatios,
  nextStatus,
  periodKey,
  resolveCardId,
  summariseBoard,
  summariseCategory,
  type BoardTotals,
  type CategoryStatus,
  type CategorySummary,
  type PlannedCategory,
  type Ratios,
} from '../core/planning';
import { groupColors } from '../theme';
import { initialiseDatabase, resetDatabase } from '../db/client';
import {
  cardRepo,
  categoryRepo,
  fundingRepo,
  incomeRepo,
  loanRepo,
  settingsRepo,
  stateRepo,
  subcategoryRepo,
  SETTINGS_KEYS,
} from '../db/repositories';
import { seedSampleTemplate } from '../db/seed';
import { cancelAllReminders } from '../services/notifications';
import type {
  Card,
  Category,
  Income,
  Loan,
  NewCard,
  NewCategory,
  NewIncome,
  NewLoan,
  NewSubcategory,
  Subcategory,
  SubcategoryState,
} from '../db/schema';

/**
 * Screen state. SQLite reads here are synchronous and fast, so the store keeps
 * plain arrays and re-reads after every mutation — derived values can never
 * drift from the database, at the cost of a full refresh per write.
 */

export interface AppState {
  ready: boolean;
  needsOnboarding: boolean;
  period: string;
  cards: Card[];
  categories: Category[];
  subcategories: Subcategory[];
  states: Map<string, SubcategoryState>;
  fundingTotals: Map<string, Minor>;
  incomes: Income[];
  loans: Loan[];
  currency: string;

  initialise: () => Promise<void>;
  refresh: () => void;
  setPeriod: (period: string) => void;
  resetAllData: () => Promise<void>;
  seedDemoData: () => void;
  completeOnboarding: () => void;
  applySampleTemplate: (existingCardId?: string | null) => void;

  cycleStatus: (subcategoryId: string) => void;
  setStatus: (subcategoryId: string, status: CategoryStatus) => void;
  setActual: (subcategoryId: string, actualMinor: Minor | null) => void;
  logTransaction: (
    subcategoryId: string,
    input: {
      status: CategoryStatus;
      actualMinor?: Minor | null;
      note?: string | null;
      imageUri?: string | null;
    },
  ) => void;
  markCategory: (categoryId: string, status: CategoryStatus) => void;

  fundCategory: (categoryId: string, amountMinor: Minor, note?: string) => void;
  unfundCategory: (categoryId: string) => void;

  reorderCategories: (orderedIds: string[]) => void;

  addCategory: (input: Omit<NewCategory, 'id' | 'color'>) => Category;
  updateCategory: (id: string, patch: Partial<NewCategory>) => void;
  deleteCategory: (id: string) => void;

  addSubcategory: (input: {
    name: string;
    categoryId: string;
    plannedMinor: Minor;
    type?: 'income' | 'expense';
    frequency?: NewSubcategory['frequency'];
    icon?: string;
    cardId?: string | null;
    dueDay?: number | null;
    loanId?: string | null;
  }) => Subcategory;
  updateSubcategory: (id: string, patch: Partial<Subcategory>) => void;
  deleteSubcategory: (id: string) => void;

  addCard: (input: Omit<NewCard, 'id' | 'color'>) => Card;
  updateCard: (id: string, patch: Partial<NewCard>) => void;
  deleteCard: (id: string) => void;

  addIncome: (input: Omit<NewIncome, 'id'>) => void;
  updateIncome: (id: string, patch: Partial<NewIncome>) => void;
  deleteIncome: (id: string) => void;

  addLoan: (input: Omit<NewLoan, 'id'>) => void;
  deleteLoan: (id: string) => void;
}

/** Round-robin tint so every new item stays visually distinct with zero picker. */
function nextColor(existingCount: number): string {
  return groupColors[existingCount % groupColors.length];
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  needsOnboarding: false,
  period: periodKey(new Date()),
  cards: [],
  categories: [],
  subcategories: [],
  states: new Map(),
  fundingTotals: new Map(),
  incomes: [],
  loans: [],
  currency: 'LKR',

  async initialise() {
    initialiseDatabase();
    get().refresh();
    set({
      ready: true,
      needsOnboarding: settingsRepo.get(SETTINGS_KEYS.onboarded) !== 'true',
    });
  },

  refresh() {
    const { period } = get();
    set({
      cards: cardRepo.all(),
      categories: categoryRepo.all(),
      subcategories: subcategoryRepo.all(),
      states: stateRepo.byPeriod(period),
      fundingTotals: fundingRepo.totalsByPeriod(period),
      incomes: incomeRepo.all(),
      loans: loanRepo.all(),
      currency: settingsRepo.get(SETTINGS_KEYS.currency) ?? 'LKR',
    });
  },

  setPeriod(period) {
    set({ period });
    get().refresh();
  },

  /**
   * "Clear all data" in settings. Wipes every table, cancels any local
   * notifications scheduled for categories that no longer exist, and marks
   * the app as already-onboarded so it comes back empty rather than
   * replaying the onboarding wizard.
   */
  async resetAllData() {
    await cancelAllReminders().catch((error) =>
      console.warn('Reminder cancel skipped:', error),
    );
    resetDatabase();
    settingsRepo.set(SETTINGS_KEYS.onboarded, 'true');
    set({ period: periodKey(new Date()), needsOnboarding: false });
    get().refresh();
  },

  /** Dev-only convenience: reloads the genericized sample template. */
  seedDemoData() {
    seedSampleTemplate();
    get().refresh();
  },

  completeOnboarding() {
    settingsRepo.set(SETTINGS_KEYS.onboarded, 'true');
    set({ needsOnboarding: false });
  },

  applySampleTemplate(existingCardId) {
    seedSampleTemplate(existingCardId);
    get().refresh();
  },

  cycleStatus(subcategoryId) {
    const { period, states } = get();
    const current = states.get(subcategoryId)?.status ?? 'pending';
    stateRepo.setStatus(subcategoryId, period, nextStatus(current));
    get().refresh();
  },

  setStatus(subcategoryId, status) {
    stateRepo.setStatus(subcategoryId, get().period, status);
    get().refresh();
  },

  setActual(subcategoryId, actualMinor) {
    stateRepo.setActual(subcategoryId, get().period, actualMinor);
    get().refresh();
  },

  logTransaction(subcategoryId, input) {
    stateRepo.logTransaction(subcategoryId, get().period, input);
    get().refresh();
  },

  markCategory(categoryId, status) {
    const { period, subcategories } = get();
    const ids = subcategories.filter((s) => s.categoryId === categoryId).map((s) => s.id);
    stateRepo.setStatusForSubcategories(ids, period, status);
    get().refresh();
  },

  fundCategory(categoryId, amountMinor, note) {
    if (amountMinor <= 0) return;
    const { period, categories, subcategories, states } = get();
    const category = categories.find((c) => c.id === categoryId);

    fundingRepo.create({
      categoryId,
      cardId: category?.cardId ?? null,
      period,
      amountMinor,
      date: new Date(),
      note: note ?? null,
    });

    // Funding the category moves the money, so every still-pending
    // subcategory in it becomes "transferred" — that is what the transfer means.
    const pendingIds = subcategories
      .filter(
        (s) => s.categoryId === categoryId && (states.get(s.id)?.status ?? 'pending') === 'pending',
      )
      .map((s) => s.id);
    stateRepo.setStatusForSubcategories(pendingIds, period, 'transferred');

    get().refresh();
  },

  unfundCategory(categoryId) {
    fundingRepo.clearForCategory(categoryId, get().period);
    get().refresh();
  },

  reorderCategories(orderedIds) {
    categoryRepo.reorder(orderedIds);
    get().refresh();
  },

  addCategory(input) {
    const created = categoryRepo.create({ ...input, color: nextColor(get().categories.length) });
    get().refresh();
    return created;
  },
  updateCategory(id, patch) {
    categoryRepo.update(id, patch);
    get().refresh();
  },
  deleteCategory(id) {
    categoryRepo.remove(id);
    get().refresh();
  },

  addSubcategory(input) {
    const siblings = get().subcategories.filter((s) => s.categoryId === input.categoryId);
    const category = get().categories.find((c) => c.id === input.categoryId);
    const created = subcategoryRepo.create({
      name: input.name,
      type: input.type ?? 'expense',
      categoryId: input.categoryId,
      plannedMinor: input.plannedMinor,
      frequency: input.frequency ?? 'monthly',
      dueDay: input.dueDay ?? null,
      icon: input.icon ?? 'pricetag-outline',
      color: category?.color ?? nextColor(siblings.length),
      cardId: input.cardId ?? null,
      loanId: input.loanId ?? null,
      sortOrder: siblings.length,
    });
    get().refresh();
    return created;
  },
  updateSubcategory(id, patch) {
    subcategoryRepo.update(id, patch);
    get().refresh();
  },
  deleteSubcategory(id) {
    subcategoryRepo.remove(id);
    get().refresh();
  },

  addCard(input) {
    const created = cardRepo.create({ ...input, color: nextColor(get().cards.length) });
    get().refresh();
    return created;
  },
  updateCard(id, patch) {
    cardRepo.update(id, patch);
    get().refresh();
  },
  deleteCard(id) {
    cardRepo.remove(id);
    get().refresh();
  },

  addIncome(input) {
    incomeRepo.create(input);
    get().refresh();
  },
  updateIncome(id, patch) {
    incomeRepo.update(id, patch);
    get().refresh();
  },
  deleteIncome(id) {
    incomeRepo.remove(id);
    get().refresh();
  },

  addLoan(input) {
    loanRepo.create(input);
    get().refresh();
  },
  deleteLoan(id) {
    loanRepo.remove(id);
    get().refresh();
  },
}));

// ------------------------------------------------------------- selectors

/** A category with its subcategories, flattened and ready for status-cycling UI. */
export interface CategoryView {
  category: Category;
  card: Card | undefined;
  subcategories: PlannedCategory[];
  rawSubcategories: Subcategory[];
  summary: CategorySummary;
}

function toPlanned(subcategory: Subcategory, state: SubcategoryState | undefined): PlannedCategory {
  return {
    id: subcategory.id,
    name: subcategory.name,
    plannedMinor: subcategory.plannedMinor,
    actualMinor: state?.actualMinor ?? null,
    status: state?.status ?? 'pending',
  };
}

export function selectCategoryViews(state: AppState): CategoryView[] {
  return state.categories.map((category) => {
    const subs = state.subcategories.filter((s) => s.categoryId === category.id);
    const planned = subs.map((s) => toPlanned(s, state.states.get(s.id)));
    const funded = state.fundingTotals.get(category.id) ?? 0;

    return {
      category,
      card: state.cards.find((c) => c.id === category.cardId),
      subcategories: planned,
      rawSubcategories: subs,
      summary: summariseCategory(planned, funded),
    };
  });
}

export function selectCategoryView(state: AppState, categoryId: string): CategoryView | undefined {
  return selectCategoryViews(state).find((view) => view.category.id === categoryId);
}

export function selectBoardTotals(state: AppState): BoardTotals {
  return summariseBoard(selectCategoryViews(state).map((view) => view.summary));
}

export function selectTotalIncome(state: AppState): Minor {
  return sumMinor(state.incomes.map((income) => income.amountMinor));
}

/**
 * The spreadsheet's ratio block. A category counts as debt when it contains
 * any loan-linked subcategory, so the split follows the data rather than a
 * name match.
 */
export function selectRatios(state: AppState): Ratios {
  const views = selectCategoryViews(state);

  let loan = 0;
  let living = 0;

  for (const view of views) {
    const isDebt = view.rawSubcategories.some((s) => s.loanId);
    if (isDebt) loan += view.summary.totalMinor;
    else living += view.summary.totalMinor;
  }

  return calculateRatios({
    incomeMinor: selectTotalIncome(state),
    loanMinor: loan,
    livingMinor: living,
  });
}

/** Per-card view: what it holds and which categories draw from it. */
export interface CardView {
  card: Card;
  /** Opening balance plus everything funded into it this period. */
  balanceMinor: Minor;
  fundedInMinor: Minor;
  /** Total every leaf resolved to this card still plans to spend. */
  committedMinor: Minor;
  categoryNames: string[];
}

export function selectCardViews(state: AppState): CardView[] {
  const views = selectCategoryViews(state);

  return state.cards.map((card) => {
    const attachedCategories = views.filter((view) => view.category.cardId === card.id);
    const fundedIn = sumMinor(attachedCategories.map((view) => view.summary.fundedMinor));

    // Committed is resolved per-leaf, since a subcategory can override its
    // category's default funding card.
    let committed = 0;
    for (const view of views) {
      for (const sub of view.rawSubcategories) {
        const resolved = resolveCardId(sub.cardId, view.category.cardId);
        if (resolved !== card.id) continue;
        const planned = view.subcategories.find((p) => p.id === sub.id);
        if (!planned) continue;
        const amount = planned.actualMinor ?? planned.plannedMinor;
        if (planned.status !== 'completed') committed += amount;
      }
    }

    return {
      card,
      balanceMinor: card.openingBalanceMinor + fundedIn,
      fundedInMinor: fundedIn,
      committedMinor: committed,
      categoryNames: attachedCategories.map((view) => view.category.name),
    };
  });
}

export interface LoanView {
  loan: Loan;
  installmentMinor: Minor;
  totalInterestMinor: Minor;
  paidCount: number;
  remainingMinor: Minor;
  progressPct: number;
}

export function selectLoanViews(state: AppState): LoanView[] {
  return state.loans.map((loan) => {
    const terms = {
      principalMinor: loan.principalMinor,
      annualRatePct: loan.annualRatePct,
      termMonths: loan.termMonths,
    };
    const schedule = buildSchedule(terms);
    const paidCount = paymentsElapsed(loan.startDate, loan.termMonths);

    return {
      loan,
      installmentMinor: schedule.installmentMinor,
      totalInterestMinor: schedule.totalInterestMinor,
      paidCount,
      remainingMinor: remainingBalance(terms, paidCount),
      progressPct: loan.termMonths > 0 ? (paidCount / loan.termMonths) * 100 : 0,
    };
  });
}
