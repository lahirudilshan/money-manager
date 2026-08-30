/**
 * Derived views over AppState.
 *
 * Pure functions of the store's data, kept apart from useAppStore.ts so the
 * store file is the state and the transitions, and this is everything computed
 * from them. The dependency runs one way — selectors import AppState, the store
 * never imports a selector — so there is no cycle to reason about.
 *
 * Read them through `useAppSelector(selectCardViews)` so a component
 * subscribes to the slice it renders rather than to the whole store.
 */

import {
  buildSchedule,
  paymentsElapsed,
  remainingBalance,
} from '~/features/loans/logic/amortization';
import {
  sumMinor,
  type Minor,
} from '~/shared/lib/money';
import {
  billActual,
  billStatus,
  calculateRatios,
  daysUntil,
  isFlexibleDueDay,
  isSpend,
  monthlyAmount,
  nextDueDate,
  savingPlanProgress,
  type SavingPlan,
  type SavingPlanProgress,
  periodKey,
  resolveCardId,
  summariseBoard,
  summariseCategory,
  urgencyFor,
  type BoardTotals,
  type CategorySummary,
  type DueUrgency,
  type PlannedCategory,
  type Ratios,
  type SubcategoryStatus,
} from '~/features/budget/logic/planning';
import { stateRepo, transactionRepo } from '~/db/repositories';
import { isOngoing } from '~/db/schema';
import type { Subcategory, Transaction, Card, Category, Loan, SubcategoryState } from '~/db/schema';
import type { CategoryFundingStatus } from '~/db/schema';
import type { AppState } from '~/store/useAppStore';

/** A category with its subcategories, flattened and ready for status UI. */
export interface CategoryView {
  category: Category;
  card: Card | undefined;
  /**
   * The accounts this category's bills are ACTUALLY paid from, de-duplicated
   * and in board order.
   *
   * Derived, never stored. A category is a container: each bill inside it names
   * its own account, and the category's own `cardId` was a fourth answer to a
   * question its contents had already answered three times — a "Utilities"
   * category set to HNB whose three bills all pay from BOC still read "HNB".
   *
   * So the category now reports what its bills say. Usually that is one
   * account and reads exactly as before; when it is several, the card shows
   * them all ("HNB · BOC"), which is the honest answer and is also the signal
   * that a bill is pointed somewhere unexpected.
   *
   * A bill with no account of its own falls back to the category's `cardId`
   * (see `resolveCardId`), so this is empty only when nothing anywhere names
   * an account.
   */
  cards: Card[];
  subcategories: PlannedCategory[];
  rawSubcategories: Subcategory[];
  summary: CategorySummary;
  /** Whether the category's bulk money has been transferred this period. */
  transferStatus: CategoryFundingStatus;
  /**
   * True when every line in the category is income. Income lands directly in
   * the account, so there is nothing to "transfer" — the UI hides that action.
   */
  isIncomeOnly: boolean;
}

function toPlanned(
  subcategory: Subcategory,
  state: SubcategoryState | undefined,
  transactionTotal: Minor | undefined,
): PlannedCategory {
  /*
   * A spending-budget line (stored as `ongoing`) has no per-period paid flag:
   * its effective value is the SUM of its child transactions, always reported as
   * "actual" so the board and its entry list can never disagree.
   *
   * It DOES carry a planned amount — the monthly budget — which is what the
   * board should plan for. Reporting `plannedMinor: 0` (as this did before
   * budgets existed) made a grocery budget invisible in the month's plan until
   * money was actually spent, so the total to fund jumped around mid-month.
   * Planning the budget and recording the spend against it is what makes
   * "Rs 8,400 of Rs 20,000" true on both screens.
   *
   * It reads as paid whenever there is any spend, so it never sits in the
   * outstanding-bills list demanding to be ticked off.
   */
  if (subcategory.frequency === 'ongoing') {
    const total = transactionTotal ?? 0;
    return {
      id: subcategory.id,
      name: subcategory.name,
      plannedMinor: subcategory.plannedMinor,
      actualMinor: total,
      status: total > 0 ? 'paid' : 'pending',
      type: subcategory.type,
      // Real money already spent this month — never spread across the year.
      frequency: 'ongoing',
      period: periodKey(subcategory.createdAt),
    };
  }

  /*
   * A DATED bill: one payment a month, on a date, which can be ticked off and
   * can fall overdue. That settle step is the whole reason the two kinds exist
   * — an ongoing line above never settles, it just accumulates.
   *
   * Its single entry doubles as the settle signal: money having moved IS the
   * bill being paid. See `billActual` / `billStatus` for both rules.
   */
  return {
    id: subcategory.id,
    name: subcategory.name,
    plannedMinor: subcategory.plannedMinor,
    actualMinor: billActual(transactionTotal, state?.actualMinor),
    status: billStatus(state?.status as SubcategoryStatus | undefined, transactionTotal),
    // Carried through so the summary can keep income out of planned spend.
    type: subcategory.type,
    /*
     * A yearly line is reported as yearly so the summary can spread it over the
     * months it is saved for — EXCEPT when it carries a saving plan, where
     * `plannedMinor` is already the monthly set-aside (the annual total lives in
     * `planTargetMinor`). Dividing that again would understate the plan by 12x,
     * so such lines are declared monthly, which they effectively are.
     */
    frequency:
      subcategory.planTargetMinor != null && subcategory.frequency === 'yearly'
        ? 'monthly'
        : subcategory.frequency,
    /*
     * The month a one-time cost belongs to: the month the user says it was
     * paid, falling back to the month the line was created for rows written
     * before that field existed. The distinction matters — a cost paid in May
     * can be recorded in July, and anchoring to creation would then count it in
     * the wrong month.
     */
    period: subcategory.onceInPeriod ?? periodKey(subcategory.createdAt),
  };
}

/**
 * Cache for `selectCategoryViews`, keyed by the exact state slices it reads.
 *
 * This selector is the app's hot path: six other selectors call it internally,
 * and the dashboard runs seven of those in one render — so a single mount
 * rebuilt every category view roughly a dozen times. On a real device that
 * measured as a 400ms block on the JS thread during launch.
 *
 * A one-entry cache is enough because the store replaces these arrays wholesale
 * on every `refresh()`, so reference equality is an exact test for "the data
 * did not change" — no deep comparison and no staleness risk. Anything that
 * mutates the board goes through `refresh()`, which produces new references and
 * invalidates this automatically.
 */
let categoryViewsCache: { deps: unknown[]; value: CategoryView[] } | null = null;

export function selectCategoryViews(state: AppState): CategoryView[] {
  const deps = [
    state.categories,
    state.subcategories,
    state.states,
    state.categoryStates,
    state.fundingTotals,
    state.transactionTotals,
    state.cards,
    state.period,
  ];

  if (
    categoryViewsCache &&
    categoryViewsCache.deps.length === deps.length &&
    categoryViewsCache.deps.every((dep, i) => dep === deps[i])
  ) {
    return categoryViewsCache.value;
  }

  const value = buildCategoryViews(state);
  categoryViewsCache = { deps, value };
  return value;
}

function buildCategoryViews(state: AppState): CategoryView[] {
  return state.categories.map((category) => {
    const subs = state.subcategories.filter((s) => s.categoryId === category.id);
    const planned = subs.map((s) =>
      toPlanned(s, state.states.get(s.id), state.transactionTotals.get(s.id)),
    );
    const funded = state.fundingTotals.get(category.id) ?? 0;

    /*
     * Walked in SUBCATEGORY order, not `state.cards` order, so the account the
     * first bill uses is the one that leads the list — that is the account the
     * user thinks of as this category's, and re-sorting it behind another bank
     * because of the accounts screen's ordering would be arbitrary.
     */
    const cardIds: string[] = [];
    for (const sub of subs) {
      const id = sub.cardId ?? category.cardId;
      if (id && !cardIds.includes(id)) cardIds.push(id);
    }
    const cards = cardIds
      .map((id) => state.cards.find((c) => c.id === id))
      .filter((c): c is Card => c !== undefined);

    return {
      category,
      /*
       * Kept as the category's own default — it still seeds a new bill's
       * account picker and is what `resolveCardId` falls back to. The UI leads
       * with `cards` instead, which is what the bills actually say.
       */
      card: state.cards.find((c) => c.id === category.cardId),
      cards,
      subcategories: planned,
      rawSubcategories: subs,
      // Scoped to the viewed month so a one-time cost counts only in its own.
      summary: summariseCategory(planned, funded, state.period),
      transferStatus: state.categoryStates.get(category.id)?.status ?? 'pending',
      isIncomeOnly: subs.length > 0 && subs.every((s) => s.type === 'income'),
    };
  });
}

/** All transactions for an ongoing subcategory in the current period, newest
 * first — drives the entry list on the subcategory and list screens. Reads the
 * DB directly (not the totals map) since the UI needs each row, not just a sum. */
export function selectTransactions(state: AppState, subcategoryId: string): Transaction[] {
  return transactionRepo.bySubcategoryPeriod(subcategoryId, state.period);
}

export function selectCategoryView(state: AppState, categoryId: string): CategoryView | undefined {
  return selectCategoryViews(state).find((view) => view.category.id === categoryId);
}

/**
 * Subcategories a draft can be logged against, restricted to the matching type
 * (a credit → income lines, a debit/bill → expense lines) so the picker never
 * offers a nonsensical target. Ordered as the reconciler ranked them.
 */
export function selectDraftTargets(state: AppState, draftId: string): Subcategory[] {
  const draft = state.smsDrafts.find((d) => d.id === draftId);
  if (!draft) return [];

  /*
   * Every line the user could sensibly log against, MATCHING FIRST.
   *
   * This used to hard-filter by direction — a debit saw only `expense` lines —
   * which meant most of the board simply vanished from the picker. Two ways
   * that goes wrong: the parser reads the direction from wording and can get it
   * backwards (a refund, an own-account transfer), and a user may legitimately
   * want a credit against a line typed as an expense. Hiding those left no
   * route to the right bill at all.
   *
   * So the likely type leads and the rest follow, rather than being removed.
   * Archived lines are excluded outright — they are deleted, not merely
   * unlikely, and offering one would resurrect a line the user removed.
   */
  const likelyType = draft.parsed.direction === 'credit' ? 'income' : 'expense';
  const live = state.subcategories.filter((s) => s.archivedAt == null);

  return [
    ...live.filter((s) => s.type === likelyType),
    ...live.filter((s) => s.type !== likelyType),
  ];
}

/** The category name a subcategory belongs to — for draft picker labels. */
export function categoryNameOf(state: AppState, subcategoryId: string): string {
  const sub = state.subcategories.find((s) => s.id === subcategoryId);
  const category = sub && state.categories.find((c) => c.id === sub.categoryId);
  return category?.name ?? '';
}

export function selectBoardTotals(state: AppState): BoardTotals {
  return summariseBoard(selectCategoryViews(state).map((view) => view.summary));
}

/**
 * Everything expected to come in this month.
 *
 * Income arrives two ways and both must count, or the dashboard compares spend
 * against only part of the money: the dedicated `incomes` table (salary and the
 * like), plus any board line explicitly typed as income. Without the second,
 * a plan whose income lives on the board reads as spending far beyond its means.
 */
export function selectTotalIncome(state: AppState): Minor {
  const declared = sumMinor(state.incomes.map((income) => income.amountMinor));

  /*
   * Board income lines, minus any that the `incomes` table already declares.
   *
   * Onboarding writes a salary BOTH ways — as a board line and as an income row
   * — so adding the two sources wholesale counted it twice, and the dashboard
   * reported double the real figure. Matching on name and amount is enough to
   * spot that pairing: they are created together from one entry, so they agree
   * exactly, while two genuinely separate sources that happen to share a name
   * would also share an amount and be a duplicate in substance anyway.
   */
  const declaredKeys = new Set(
    state.incomes.map((income) => `${income.name.trim().toLowerCase()}:${income.amountMinor}`),
  );

  const onBoard = sumMinor(
    selectCategoryViews(state).flatMap((view) =>
      view.rawSubcategories
        .filter(
          (line) =>
            line.type === 'income' &&
            !declaredKeys.has(`${line.name.trim().toLowerCase()}:${line.plannedMinor}`),
        )
        .map((line) => line.plannedMinor),
    ),
  );

  return declared + onBoard;
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

  /*
   * Split per *line*, not per category. Every loan now lives under the one
   * shared Debt category, so a category-level test would count anything else
   * filed there as debt — and, before consolidation, would have counted a whole
   * mixed category as debt because of a single loan line in it. The loan link
   * is a property of the line, so that is what decides.
   */
  for (const view of views) {
    for (const line of view.subcategories) {
      // Income is not spend and belongs to neither bucket.
      if (!isSpend(line)) continue;
      const raw = view.rawSubcategories.find((s) => s.id === line.id);
      const amount = monthlyAmount(line);
      if (raw?.loanId) loan += amount;
      else living += amount;
    }
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
  /** Opening balance, plus what was funded in, minus what has been paid out. */
  balanceMinor: Minor;
  fundedInMinor: Minor;
  /** Value of bills drawing on this card already marked paid this period. */
  spentMinor: Minor;
  /** Total every leaf resolved to this card still plans to spend. */
  committedMinor: Minor;
  categoryNames: string[];
}

export function selectCardViews(state: AppState): CardView[] {
  const views = selectCategoryViews(state);

  return state.cards.map((card) => {
    const attachedCategories = views.filter((view) => view.category.cardId === card.id);
    const fundedIn = sumMinor(attachedCategories.map((view) => view.summary.fundedMinor));

    // Committed and spent are resolved per-leaf, since a subcategory can
    // override its category's default funding card.
    let committed = 0;
    let spent = 0;
    for (const view of views) {
      for (const sub of view.rawSubcategories) {
        const resolved = resolveCardId(sub.cardId, view.category.cardId);
        if (resolved !== card.id) continue;
        const planned = view.subcategories.find((p) => p.id === sub.id);
        if (!planned) continue;
        // Income arrives in the account; it is neither a bill to pay nor a
        // deduction from the balance, so it takes no part in either figure.
        if (sub.type === 'income') continue;
        const amount = planned.actualMinor ?? planned.plannedMinor;
        if (planned.status === 'paid') spent += amount;
        else committed += amount;
      }
    }

    return {
      card,
      // A balance is money in *minus money out*. Funding moves money onto the
      // card and paying a bill takes it off again; without the subtraction the
      // figure only ever grows and overstates what the account actually holds.
      balanceMinor: card.openingBalanceMinor + fundedIn - spent,
      fundedInMinor: fundedIn,
      spentMinor: spent,
      committedMinor: committed,
      categoryNames: attachedCategories.map((view) => view.category.name),
    };
  });
}

/**
 * What one account needs to receive this month: the sum of every planned line
 * that draws from it and has not yet been transferred.
 *
 * This is the dashboard's "move this much to each account" answer. It resolves
 * per leaf (a subcategory can override its category's card), and splits the
 * total by whether the line's CATEGORY has been marked transferred — the state
 * the dashboard's slider writes.
 *
 * Deliberately not keyed on whether the bills are paid. Paying a bill from an
 * account says nothing about whether the salary money was moved there, and
 * conflating the two made an account with settled bills read as "all moved"
 * before the user had transferred anything.
 */
export interface AccountTransferView {
  card: Card;
  /** Still to move onto this card. */
  toTransferMinor: Minor;
  /** Everything planned against this card this month, moved or not. */
  plannedMinor: Minor;
  /** Already moved (transferred or completed). */
  movedMinor: Minor;
  /** Number of lines still awaiting a transfer. */
  pendingCount: number;
  /** Category names drawing from this card, for the row's subtitle. */
  categoryNames: string[];
}

export function selectAccountTransfers(state: AppState): AccountTransferView[] {
  const views = selectCategoryViews(state);

  return state.cards
    .map((card) => {
      let toTransfer = 0;
      let planned = 0;
      let moved = 0;
      let pendingCount = 0;
      const categoryNames = new Set<string>();

      for (const view of views) {
        for (const sub of view.rawSubcategories) {
          if (resolveCardId(sub.cardId, view.category.cardId) !== card.id) continue;

          const line = view.subcategories.find((p) => p.id === sub.id);
          if (!line) continue;
          // Income lands *in* an account rather than being moved out to it.
          if (sub.type === 'income') continue;

          const amount = line.actualMinor ?? line.plannedMinor;
          planned += amount;
          categoryNames.add(view.category.name);

          /*
           * Moved-ness comes from the CATEGORY's transfer state, not from
           * whether its bills are paid.
           *
           * These are two different real-world steps and were conflated here: a
           * bill being `paid` meant "this account needs no more money", so an
           * account whose bills happened to be settled showed as fully moved
           * even though the user had never transferred anything — and the
           * slider could not be reverted, because the state it reads was never
           * the state it writes.
           *
           * Paying a bill from an account says nothing about whether the salary
           * money was moved there; the user might have paid it from whatever
           * balance was already sitting on the card.
           */
          const transferred =
            (state.categoryStates.get(view.category.id)?.status ?? 'pending') === 'transferred';

          if (transferred) {
            moved += amount;
          } else {
            toTransfer += amount;
            pendingCount += 1;
          }
        }
      }

      return {
        card,
        toTransferMinor: toTransfer,
        plannedMinor: planned,
        movedMinor: moved,
        pendingCount,
        categoryNames: [...categoryNames],
      };
    })
    .filter((view) => view.plannedMinor > 0)
    .sort((a, b) => b.toTransferMinor - a.toTransferMinor);
}

/**
 * An unpaid line surfaced on the dashboard, with how close its due date is.
 * Overdue first, then soonest — the order the user should act in.
 */
export interface ReminderView {
  subcategory: Subcategory;
  categoryName: string;
  categoryColor: string;
  card: Card | undefined;
  amountMinor: Minor;
  status: SubcategoryStatus;
  dueDate: Date;
  daysUntil: number;
  urgency: DueUrgency;
}

/** A bill with a saving plan, plus how far along it is. */
export interface SavingPlanView {
  subcategory: Subcategory;
  categoryName: string;
  categoryColor: string;
  plan: SavingPlan;
  progress: SavingPlanProgress;
}

/**
 * Every bill that carries a saving plan, with progress derived from how many
 * months have actually been marked paid since the plan started.
 *
 * Counting *paid months* rather than a stored running total means the figure
 * can never drift from the checklist the user actually ticks, and re-opening
 * an old month corrects it automatically.
 */
export function selectSavingPlans(state: AppState, today = new Date()): SavingPlanView[] {
  const plans: SavingPlanView[] = [];

  for (const category of state.categories) {
    for (const sub of state.subcategories) {
      if (sub.categoryId !== category.id) continue;
      if (sub.planTargetMinor == null || !sub.planDueDate) continue;

      const plan: SavingPlan = {
        targetMinor: sub.planTargetMinor,
        dueDate: sub.planDueDate,
        startDate: sub.planStartDate ?? sub.createdAt,
      };

      // Each paid month contributed that month's planned set-aside.
      const paidPeriods = stateRepo.paidPeriodCount(sub.id);
      const saved = paidPeriods * sub.plannedMinor;

      plans.push({
        subcategory: sub,
        categoryName: category.name,
        categoryColor: category.color,
        plan,
        progress: savingPlanProgress(plan, saved, today),
      });
    }
  }

  // Soonest due first — the ones needing attention lead.
  return plans.sort((a, b) => a.progress.daysUntilDue - b.progress.daysUntilDue);
}

export function selectReminders(state: AppState, today = new Date()): ReminderView[] {
  const reminders: ReminderView[] = [];

  for (const category of state.categories) {
    const subs = state.subcategories.filter((s) => s.categoryId === category.id);
    for (const sub of subs) {
      if (sub.type === 'income') continue;

      /*
       * A spending budget is never a reminder.
       *
       * It has no single payment to make and is never ticked "paid" as a whole
       * — its spend is the running sum of its entries — so it could never leave
       * this list once its due day passed. A grocery budget sat on the
       * dashboard reading "2 days overdue" permanently, which is both wrong and
       * the kind of false alarm that teaches people to ignore the section.
       *
       * Its money is handled by the account transfer, and its spending shows on
       * the plan as a running total against the budget. Neither is a deadline.
       */
      if (isOngoing(sub.frequency)) continue;

      const status: SubcategoryStatus =
        (state.states.get(sub.id)?.status as SubcategoryStatus) ?? 'pending';
      // Paid means done — nothing left to remind about.
      if (status === 'paid') continue;

      // A flexible bill has no fixed date, so it can never be "overdue" and
      // must not appear in the due-date reminder list.
      const effectiveDueDay = sub.dueDay ?? category.dueDay;
      if (isFlexibleDueDay(effectiveDueDay)) continue;

      /*
       * The NEXT time this line falls due — not its date in the browsed month.
       *
       * `state.period` is whichever month the user is looking at, so anchoring
       * the reminder to it meant scrolling back to review March made every
       * unpaid March line report as weeks overdue, and scrolling forward made
       * next month's bills read as comfortably distant when one is due
       * tomorrow. "Coming up" is a statement about today, so it is computed
       * against today: this month's date while it is still ahead, otherwise the
       * same day next month.
       *
       * A line already ticked paid never reaches here (checked above), so a
       * settled bill cannot roll forward and reappear as upcoming.
       */
      const dueDate = nextDueDate(effectiveDueDay, today);
      reminders.push({
        subcategory: sub,
        categoryName: category.name,
        categoryColor: category.color,
        card: state.cards.find(
          (c) => c.id === resolveCardId(sub.cardId, category.cardId),
        ),
        /*
         * `??` is wrong here and was the "LKR 0" on screen: a logged actual of
         * zero is not nullish, so it won any comparison against the plan. A
         * bill can legitimately be logged at 0 (a waived charge), and the
         * reminder should then show what is still PLANNED, not the zero.
         */
        amountMinor: state.states.get(sub.id)?.actualMinor || sub.plannedMinor,
        status,
        dueDate,
        daysUntil: daysUntil(dueDate, today),
        urgency: urgencyFor(dueDate, today),
      });
    }
  }

  return reminders.sort((a, b) => a.daysUntil - b.daysUntil);
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
      // Reducing-balance vs flat — a lease quoted flat costs materially more
      // per month than the same headline rate reducing. See core/amortization.
      interestMethod: loan.interestMethod,
    };
    const schedule = buildSchedule(terms);
    // Prefer the explicit "installments paid" the user entered; fall back to
    // deriving it from the start date for loans created before that field
    // existed (where it defaults to 0).
    const paidCount =
      loan.paidInstallments > 0
        ? Math.min(loan.paidInstallments, loan.termMonths)
        : paymentsElapsed(loan.startDate, loan.termMonths);

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
