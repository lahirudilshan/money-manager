import { describe, expect, it, vi } from 'vitest';

/*
 * The repositories reach for expo-sqlite, which does not exist in node. Only two
 * methods are ever called from the selectors under test, and both are per-period
 * reads that a board with no logged money answers with an empty list — so the
 * stub is the honest answer here rather than a convenience.
 */
vi.mock('~/db/repositories', () => ({
  stateRepo: { byPeriod: () => [] },
  transactionRepo: { bySubcategoryPeriod: () => [] },
}));

import {
  selectAccountTransfers,
  selectBoardTotals,
  selectCardViews,
  selectCategoryViews,
  selectRatios,
  selectReminders,
  selectTotalIncome,
} from '~/store/selectors';
import { effectiveAmount, monthlyAmount, resolveCardId } from '~/features/budget/logic/planning';
import type { AppState } from '~/store/useAppStore';

/**
 * Every money figure the app shows, cross-checked against one board.
 *
 * The unit tests around these helpers each prove one rule in isolation. What
 * they cannot catch is two screens disagreeing: the dashboard, the list tab, the
 * account detail and the card list all answer "how much" from the SAME board
 * through DIFFERENT selectors, and every bug found on this board so far has
 * lived in that gap rather than inside any one function —
 *
 *   - an ongoing line reported `0` instead of its budget, so an account funded
 *     only by budgets asked for nothing (`selectAccountTransfers`);
 *   - the account detail resolved its categories per CATEGORY while the
 *     dashboard resolved per LEAF, so an account funded by line-level overrides
 *     showed as funding nothing at all.
 *
 * Both were invisible to a per-function test and obvious the moment two screens
 * were asked the same question. So these tests drive the real selectors over one
 * fixture and assert the answers RECONCILE.
 *
 * The fixture mirrors the shape of a real board rather than a convenient one:
 * line-level account overrides, a category carrying no account of its own, a
 * yearly line with a saving plan, budgets with nothing spent, and a zero-amount
 * line. Those are the cases that broke.
 */

const PERIOD = '2026-08';

interface Line {
  id: string;
  name: string;
  categoryId: string;
  cardId: string | null;
  plannedMinor: number;
  frequency: 'monthly' | 'yearly' | 'ongoing' | 'one_time';
  type?: 'income' | 'expense';
  planTargetMinor?: number | null;
  loanId?: string | null;
}

/** Cards: two are reached ONLY through line-level overrides. */
const CARDS = [
  { id: 'card-salary', nickname: 'Salary', bankName: 'DFCC' },
  { id: 'card-household', nickname: 'Household', bankName: 'HNB' },
  { id: 'card-savings', nickname: 'Savings', bankName: 'NSB' },
  { id: 'card-unused', nickname: 'Unused', bankName: 'BOC' },
];

/** `People` deliberately carries NO account — its lines each name their own. */
const CATEGORIES = [
  { id: 'cat-living', name: 'Living', cardId: 'card-salary' },
  { id: 'cat-vehicle', name: 'Vehicle', cardId: 'card-savings' },
  { id: 'cat-people', name: 'People', cardId: null },
];

const LINES: Line[] = [
  // Dated bills, inheriting the category's account.
  { id: 'l-rent', name: 'Rent', categoryId: 'cat-living', cardId: null, plannedMinor: 35_000_00, frequency: 'monthly' },
  { id: 'l-water', name: 'Water', categoryId: 'cat-living', cardId: null, plannedMinor: 2_000_00, frequency: 'monthly' },
  // Budgets overridden onto a different account — the case that read as empty.
  { id: 'l-groceries', name: 'Groceries', categoryId: 'cat-living', cardId: 'card-household', plannedMinor: 50_000_00, frequency: 'ongoing' },
  { id: 'l-eatingout', name: 'Eating out', categoryId: 'cat-living', cardId: 'card-household', plannedMinor: 10_000_00, frequency: 'ongoing' },
  // A yearly line WITH a saving plan: `plannedMinor` is already the monthly
  // set-aside, so it must not be divided by twelve a second time.
  { id: 'l-insurance', name: 'Insurance', categoryId: 'cat-vehicle', cardId: null, plannedMinor: 16_000_00, frequency: 'yearly', planTargetMinor: 144_000_00 },
  // A budget with no amount set — allowed, contributes nothing.
  { id: 'l-bus', name: 'Bus fare', categoryId: 'cat-vehicle', cardId: null, plannedMinor: 0, frequency: 'ongoing' },
  // A category with no account of its own, reached purely by overrides.
  { id: 'l-a', name: 'Person A', categoryId: 'cat-people', cardId: 'card-household', plannedMinor: 5_000_00, frequency: 'ongoing' },
  { id: 'l-b', name: 'Person B', categoryId: 'cat-people', cardId: 'card-household', plannedMinor: 5_000_00, frequency: 'ongoing' },
];

function buildState(): AppState {
  const now = new Date('2026-08-01');
  const subcategories = LINES.map((l, i) => ({
    id: l.id,
    name: l.name,
    type: l.type ?? 'expense',
    categoryId: l.categoryId,
    cardId: l.cardId,
    plannedMinor: l.plannedMinor,
    frequency: l.frequency,
    dueDay: 1,
    icon: 'pricetag-outline',
    color: '#000000',
    loanId: l.loanId ?? null,
    onceInPeriod: null,
    planTargetMinor: l.planTargetMinor ?? null,
    planDueDate: null,
    planStartDate: null,
    planRemindDaysBefore: null,
    houseScoped: false,
    houseId: null,
    sortOrder: i,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }));

  return {
    period: PERIOD,
    cards: CARDS.map((c) => ({
      ...c,
      bankId: null,
      isCard: false,
      openingBalanceMinor: 0,
      targetMinor: null,
      color: '#000000',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })),
    categories: CATEGORIES.map((c, i) => ({
      ...c,
      color: '#000000',
      icon: 'albums-outline',
      dueDay: null,
      defaultFrequency: 'monthly',
      sortOrder: i,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })),
    subcategories,
    // No money logged anywhere — the state every one of these bugs appeared in.
    states: new Map(),
    categoryStates: new Map(),
    transactionTotals: new Map(),
    fundingTotals: new Map(),
    incomes: [{ id: 'inc', name: 'Salary', amountMinor: 750_000_00, cardId: 'card-salary', isActive: true }],
    loans: [],
    smsDrafts: [],
  } as unknown as AppState;
}

const state = buildState();
const byName = <T extends { card: { nickname: string | null } }>(rows: T[], nickname: string) =>
  rows.find((row) => row.card.nickname === nickname)!;

describe('board figures reconcile across screens', () => {
  /**
   * The headline cross-check, and the one that would have caught both bugs.
   *
   * "Money to move" sums per ACCOUNT; the board sums per CATEGORY. They walk the
   * same lines through different code, so their totals must agree exactly — a
   * mismatch means one of them is losing or double-counting a line.
   */
  it('per-account and per-category totals sum to the same figure', () => {
    const accountsTotal = selectAccountTransfers(state).reduce(
      (sum, a) => sum + a.plannedMinor,
      0,
    );
    const boardTotal = selectBoardTotals(state).plannedMinor;

    expect(accountsTotal).toBe(boardTotal);
    // 35,000 + 2,000 + 50,000 + 10,000 + 16,000 + 0 + 5,000 + 5,000
    expect(boardTotal).toBe(123_000_00);
  });

  /** Every line must be funded by exactly one account — none lost, none doubled. */
  it('assigns every line to exactly one account', () => {
    const transfers = selectAccountTransfers(state);
    const counted = transfers.reduce((sum, a) => sum + a.pendingCount, 0);
    // The zero-amount line still belongs to an account; it just adds nothing.
    expect(counted).toBe(LINES.length);
  });

  /**
   * The regression: a budget asks for its full amount before anything is spent.
   * An account funded ONLY by budgets must never read as empty.
   */
  it('funds an account reached only by ongoing overrides', () => {
    const household = byName(selectAccountTransfers(state), 'Household');

    // Groceries + Eating out + Person A + Person B
    expect(household.plannedMinor).toBe(70_000_00);
    expect(household.toTransferMinor).toBe(70_000_00);
    expect(household.empty).toBe(false);
  });

  /** An account nothing resolves to is listed, but marked empty rather than moved. */
  it('marks a genuinely unfunded account empty, not moved', () => {
    const unused = byName(selectAccountTransfers(state), 'Unused');

    expect(unused.plannedMinor).toBe(0);
    expect(unused.empty).toBe(true);
    expect(unused.toTransferMinor).toBe(0);
  });

  /**
   * A category carrying no account of its own is still funded, through its
   * lines. Resolving per category rather than per leaf lost this entirely.
   */
  it('funds a category that names no account of its own', () => {
    const household = byName(selectAccountTransfers(state), 'Household');
    expect(household.categoryNames).toContain('People');
    expect(household.categoryNames).toContain('Living');
  });

  /**
   * The account-detail screen's grouping, which must match the dashboard row it
   * is opened from — the exact pair that disagreed.
   */
  it('account detail agrees with the dashboard row it opens from', () => {
    for (const account of selectAccountTransfers(state)) {
      // The per-leaf regrouping the detail screen performs.
      const detailTotal = selectCategoryViews(state)
        .flatMap((view) =>
          view.subcategories.filter((line) => {
            const raw = view.rawSubcategories.find((r) => r.id === line.id);
            return resolveCardId(raw?.cardId, view.category.cardId) === account.card.id;
          }),
        )
        .reduce((sum, line) => sum + effectiveAmount(line), 0);

      expect(detailTotal).toBe(account.plannedMinor);
    }
  });

  /**
   * A yearly line WITH a saving plan already holds its monthly set-aside, so
   * both helpers must report the same figure. Dividing again understates the
   * month by twelve.
   */
  it('does not divide a saving-plan yearly line twice', () => {
    const line = selectCategoryViews(state)
      .flatMap((v) => v.subcategories)
      .find((l) => l.id === 'l-insurance')!;

    expect(effectiveAmount(line)).toBe(16_000_00);
    expect(monthlyAmount(line)).toBe(16_000_00);
  });

  /** Income counts once, and only from active rows. */
  it('reports income without double-counting the board', () => {
    expect(selectTotalIncome(state)).toBe(750_000_00);
  });

  /** The ratio bar is built from the same spend the board reports. */
  it('builds ratios from the same spend as the board', () => {
    const ratios = selectRatios(state);
    const board = selectBoardTotals(state);
    const income = selectTotalIncome(state);

    const spendPct = ((board.plannedMinor / income) * 100);
    expect(ratios.loanPct + ratios.livingPct).toBeCloseTo(spendPct, 1);
    expect(ratios.loanPct + ratios.livingPct + ratios.freePct).toBeCloseTo(100, 1);
  });

  /** The card list's committed figure resolves per leaf, like the transfers do. */
  it('card view commitments match the account transfer totals', () => {
    const transfers = selectAccountTransfers(state);
    for (const view of selectCardViews(state)) {
      const match = transfers.find((t) => t.card.id === view.card.id)!;
      expect(view.committedMinor).toBe(match.plannedMinor);
    }
  });

  /**
   * A BUDGETLESS ongoing line never appears as a bill to tick off.
   *
   * It has nothing it can reach that makes it finished, so it could never
   * leave the list once its due day passed — a permanent "2 days overdue" that
   * teaches people to ignore the section.
   *
   * A budgeted one is different and DOES belong here: a LKR 15,000 monthly
   * transfer with a due day is a real obligation, and it clears itself when
   * spending reaches the budget (see `isObligationMet`). Excluding those meant
   * a real monthly payment never showed in "Coming up" at all.
   */
  it('keeps budgetless ongoing lines out of the reminder list', () => {
    const reminders = selectReminders(state);
    const budgetless = LINES.filter(
      (l) => l.frequency === 'ongoing' && (l.plannedMinor ?? 0) <= 0,
    ).map((l) => l.id);

    for (const reminder of reminders) {
      expect(budgetless).not.toContain(reminder.subcategory.id);
    }
  });

  /** The other half of that rule: a budgeted ongoing line is eligible. */
  it('allows a budgeted ongoing line into the reminder list', () => {
    const reminders = selectReminders(state);
    const budgeted = LINES.filter(
      (l) => l.frequency === 'ongoing' && (l.plannedMinor ?? 0) > 0,
    ).map((l) => l.id);

    // Only meaningful when the fixture actually has one.
    if (budgeted.length > 0) {
      expect(reminders.some((r) => budgeted.includes(r.subcategory.id))).toBe(true);
    }
  });

  /** No screen may report a negative or NaN figure from a well-formed board. */
  it('reports no NaN or negative totals anywhere', () => {
    const figures = [
      ...selectAccountTransfers(state).flatMap((a) => [a.plannedMinor, a.toTransferMinor, a.movedMinor]),
      ...selectCardViews(state).flatMap((c) => [c.committedMinor, c.spentMinor]),
      selectBoardTotals(state).plannedMinor,
      selectTotalIncome(state),
    ];

    for (const figure of figures) {
      expect(Number.isFinite(figure)).toBe(true);
      expect(figure).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * The same board once money has actually been SPENT.
 *
 * Everything above runs on a board with nothing logged, which is the state the
 * three shipped bugs appeared in — and, it turns out, the only state that was
 * ever tested. Both e2e snapshots hold zero transactions, so every figure this
 * suite has verified so far was "planned amounts only".
 *
 * That leaves the whole second half of the money code unexercised. Each rule
 * fixed today has a branch for "nothing logged" and a branch for "something
 * logged", and only the first was under test:
 *
 *   - a budget takes the LARGER of its plan and its spend, so an overspent
 *     grocery line must ask for the real figure rather than its budget;
 *   - a dated bill switches from planned to actual the moment money moves, and
 *     settles itself in doing so;
 *   - a settled bill moves out of `committed` and into `spent` on the card,
 *     while a budget never does — it accumulates instead.
 *
 * These drive the same selectors over a spent-in board and assert the figures
 * still reconcile across screens, which is what no test covered.
 */
function buildSpentState(spend: Record<string, number>): AppState {
  const base = buildState();
  return {
    ...base,
    // What the repositories report per line for this period.
    transactionTotals: new Map(Object.entries(spend)),
  } as unknown as AppState;
}

describe('board figures once money has been spent', () => {
  /** Groceries part-spent, rent paid in full, insurance untouched. */
  const spent = buildSpentState({
    'l-groceries': 12_000_00,
    'l-rent': 35_000_00,
  });

  /**
   * A part-spent budget still asks for its whole budget: the money has to be
   * on the card to be spent. This is the rule the dashboard bug got wrong.
   */
  it('still funds a budget in full while it is only part spent', () => {
    const household = byName(selectAccountTransfers(spent), 'Household');

    // Groceries 50,000 (budget, not the 12,000 spent) + Eating out 10,000
    // + Person A 5,000 + Person B 5,000.
    expect(household.plannedMinor).toBe(70_000_00);
  });

  /** An overspent budget asks for the real figure, which is now the larger. */
  it('funds an overspent budget at its real cost', () => {
    const over = buildSpentState({ 'l-groceries': 62_000_00 });
    const household = byName(selectAccountTransfers(over), 'Household');

    // 62,000 actual (> 50,000 budget) + 10,000 + 5,000 + 5,000.
    expect(household.plannedMinor).toBe(82_000_00);
  });

  /**
   * A dated bill takes its ACTUAL once money moves — the electricity bill that
   * came in over estimate is what the account really owes.
   */
  it('takes a dated bill at what it actually cost', () => {
    const over = buildSpentState({ 'l-rent': 37_500_00 });
    const salary = byName(selectAccountTransfers(over), 'Salary');
    const flat = byName(selectAccountTransfers(state), 'Salary');

    expect(over.transactionTotals.get('l-rent')).toBe(37_500_00);
    expect(salary.plannedMinor - flat.plannedMinor).toBe(2_500_00);
  });

  /**
   * The cross-screen check, on a spent-in board. Per-account and per-category
   * are still different code paths and must still agree — this is the assertion
   * that caught the cards-tab bug, now run in the state it was never run in.
   */
  it('still reconciles per-account against per-category after spending', () => {
    const accountsTotal = selectAccountTransfers(spent).reduce(
      (sum, a) => sum + a.plannedMinor,
      0,
    );

    expect(accountsTotal).toBe(selectBoardTotals(spent).plannedMinor);
  });

  /**
   * A settled bill leaves the commitment; a budget never does.
   *
   * `toPlanned` marks a budget `paid` as soon as anything is logged against it,
   * which is what moved a whole grocery line into `spent` and made the card
   * claim nothing was left to pay with most of the budget still unspent.
   */
  it('keeps a part-spent budget committed rather than calling it settled', () => {
    const household = selectCardViews(spent).find(
      (view) => view.card.nickname === 'Household',
    )!;

    // The budget is still owed in full even though 12,000 of it has gone.
    expect(household.committedMinor).toBe(70_000_00);
    expect(household.spentMinor).toBe(12_000_00);
  });

  /** No figure goes negative or NaN once real money is in play. */
  it('reports no negative or NaN figures on a spent-in board', () => {
    for (const account of selectAccountTransfers(spent)) {
      expect(Number.isFinite(account.plannedMinor)).toBe(true);
      expect(account.plannedMinor).toBeGreaterThanOrEqual(0);
      expect(account.toTransferMinor).toBeGreaterThanOrEqual(0);
    }
  });
});
