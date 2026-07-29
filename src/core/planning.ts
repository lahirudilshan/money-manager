import { percentOf, sumMinor, type Minor } from './money';

/**
 * The funding-board domain logic, as pure functions.
 *
 * Status lives at two independent levels, mirroring how the money actually
 * moves:
 *
 *   Category  pending -> transferred   the *bulk* money (e.g. salary) landing
 *                                       in the assigned account. Marked once.
 *   Subcategory  pending -> paid        each individual bill (rent, utilities)
 *                                       being paid out of that account.
 *
 * The two do not derive from each other: transferring the bulk money does not
 * pay any bill, and paying bills does not imply the bulk transfer happened.
 */

/** Per-bill state — has this individual line been paid this month. */
export type SubcategoryStatus = 'pending' | 'paid';

/** Per-category state — has the bulk money been moved to its account. */
export type CategoryFundingStatus = 'pending' | 'transferred';

/**
 * Back-compat alias. The stored column still uses the old 3-value enum; it is
 * mapped down to the 2-value `SubcategoryStatus` at the repository boundary
 * (`transferred`/`completed` both read as `paid`), so nothing above the DB
 * layer sees the legacy values.
 */
export type CategoryStatus = SubcategoryStatus;

/** The two subcategory states, in cycle order. */
export const STATUS_ORDER: SubcategoryStatus[] = ['pending', 'paid'];

export interface PlannedCategory {
  id: string;
  name: string;
  plannedMinor: Minor;
  /** Overrides plannedMinor when the real amount differed. */
  actualMinor?: Minor | null;
  status: SubcategoryStatus;
  /**
   * Whether this line is money going out or money coming in. Income lines live
   * on the board alongside expenses, but they are NOT planned spend — counting
   * them as such is what made a category's total (and the dashboard's PLANNED)
   * exceed the income it was supposed to be measured against.
   */
  type?: 'income' | 'expense';
  /**
   * How often the line recurs. Needed so a yearly bill can be spread across the
   * months it is actually saved for, rather than counted at full value every
   * month. Absent means monthly, the historic default.
   */
  frequency?: 'monthly' | 'one_time' | 'yearly' | 'unplanned';
  /**
   * "YYYY-MM" a one-time cost belongs to. A one-off is real spending in its own
   * month and nothing at all in any other, so it needs an anchor; without one
   * it would recur forever, which is exactly what a one-time cost is not.
   * Ignored for every other frequency.
   */
  period?: string;
}

/**
 * Whether a line counts toward a given month's plan.
 *
 * Only one-time costs are month-specific: they belong to the month they were
 * incurred and must not reappear in later ones. Everything else recurs (or, for
 * unplanned lines, is already scoped to the period by its transactions).
 */
export function appliesToPeriod(category: PlannedCategory, period: string): boolean {
  if (category.frequency !== 'one_time') return true;
  // No anchor means we cannot say it belongs elsewhere; count it, so an older
  // line without the field behaves as it always did rather than vanishing.
  if (!category.period) return true;
  return category.period === period;
}

/** Amount that actually counts for a category — actual if set, else planned. */
export function effectiveAmount(category: PlannedCategory): Minor {
  return category.actualMinor ?? category.plannedMinor;
}

/**
 * What a line costs *in a single month* — the figure the monthly plan should
 * be built from.
 *
 * A yearly bill is paid once but budgeted for all year, so its monthly cost is
 * a twelfth of its face value. Counting it at full value every month inflated
 * the plan roughly elevenfold for that line and made PLANNED exceed income on
 * boards that were actually affordable.
 *
 * Everything else already recurs monthly (or, for one-time and unplanned lines,
 * is a real cost in the month it appears) and is taken at face value.
 *
 * A saving plan is the exception among yearly lines: its `plannedMinor` is
 * already the monthly set-aside, so it must NOT be divided again. Callers pass
 * such lines with `frequency: 'monthly'`, or use `monthlyAmount` only where
 * that distinction has been resolved.
 */
export function monthlyAmount(category: PlannedCategory): Minor {
  const amount = effectiveAmount(category);
  if (category.frequency !== 'yearly') return amount;
  // Round to the cent so twelve months sum back to the annual figure closely;
  // exactness per-month matters less than never overstating the monthly plan.
  return Math.round(amount / 12);
}

/**
 * True for a line that represents money leaving — everything except an income
 * line. Untyped lines are treated as expenses, which is the historic default
 * and keeps old callers behaving exactly as before.
 */
export function isSpend(category: PlannedCategory): boolean {
  return category.type !== 'income';
}

/** Toggle a bill between pending and paid — the only two states it has. */
export function nextStatus(current: SubcategoryStatus): SubcategoryStatus {
  return current === 'paid' ? 'pending' : 'paid';
}

/** True once a bill is paid. */
export function isPaid(status: SubcategoryStatus): boolean {
  return status === 'paid';
}

export interface CategorySummary {
  /** Sum of every subcategory's effective amount. */
  totalMinor: Minor;
  /** Sum actually transferred onto the card for this period. */
  fundedMinor: Minor;
  /** Still to transfer; never negative. */
  shortfallMinor: Minor;
  /** Transferred beyond the plan; never negative. */
  surplusMinor: Minor;
  /** 0-100, clamped — safe for progress bars. */
  fundedPct: number;
  /** Value of subcategories marked paid. */
  paidMinor: Minor;
  /** Value still awaiting payment. */
  outstandingMinor: Minor;
  counts: Record<SubcategoryStatus, number>;
  subcategoryCount: number;
  /** True when every subcategory is paid (and there is at least one). */
  isSettled: boolean;
  /** True when transfers cover the full plan. */
  isFullyFunded: boolean;
  /**
   * Money *expected in* from this category's income lines. Kept separate from
   * `totalMinor` (which is spend only) so a category holding both can report
   * each without one masking the other.
   */
  incomeMinor: Minor;
}

/**
 * Roll a category's lines into the figures the board displays.
 *
 * Only *spend* lines contribute to `totalMinor`, `paidMinor` and the funding
 * maths: an income line sitting in a category is money arriving, so adding it
 * to the planned total would overstate what the category costs — and, summed
 * across the board, would push PLANNED above INCOME on the dashboard.
 */
export function summariseCategory(
  subcategories: readonly PlannedCategory[],
  fundedMinor: Minor,
  /**
   * The month being summarised, so a one-time cost only counts in its own.
   * Optional: omitting it keeps every line, which is the pre-existing behaviour
   * and what callers that summarise a whole board (rather than a month) want.
   */
  period?: string,
): CategorySummary {
  const applicable = period
    ? subcategories.filter((s) => appliesToPeriod(s, period))
    : subcategories;
  const spend = applicable.filter(isSpend);
  // Monthly cost, not face value — a yearly bill is spread over the year it is
  // saved for rather than charged in full every month.
  const total = sumMinor(spend.map(monthlyAmount));
  const incomeMinor = sumMinor(
    applicable.filter((s) => !isSpend(s)).map(monthlyAmount),
  );

  const counts: Record<SubcategoryStatus, number> = { pending: 0, paid: 0 };

  let paid = 0;
  for (const subcategory of spend) {
    counts[subcategory.status] += 1;
    if (subcategory.status === 'paid') paid += monthlyAmount(subcategory);
  }

  const difference = fundedMinor - total;

  return {
    totalMinor: total,
    fundedMinor,
    shortfallMinor: Math.max(0, -difference),
    surplusMinor: Math.max(0, difference),
    fundedPct: total > 0 ? Math.min(100, Math.max(0, percentOf(fundedMinor, total))) : 0,
    paidMinor: paid,
    outstandingMinor: total - paid,
    counts,
    // Counts describe the checklist, which is the spend lines — an income line
    // is never "paid", so including it would leave a category always unsettled.
    subcategoryCount: spend.length,
    isSettled: spend.length > 0 && counts.paid === spend.length,
    isFullyFunded: total > 0 && fundedMinor >= total,
    incomeMinor,
  };
}

/**
 * What a category still needs transferred. Callers use this to prefill the
 * "fund this category" action, so it is clamped at zero — never suggest
 * moving a negative amount.
 */
export function amountToFund(summary: CategorySummary): Minor {
  return summary.shortfallMinor;
}

/**
 * Which card a subcategory's money actually goes to. A subcategory can
 * override its parent category's default card; the more specific override
 * wins.
 */
export function resolveCardId(
  subcategoryCardId: string | null | undefined,
  categoryCardId: string | null | undefined,
): string | null {
  return subcategoryCardId ?? categoryCardId ?? null;
}

export interface BoardTotals {
  plannedMinor: Minor;
  fundedMinor: Minor;
  paidMinor: Minor;
  outstandingMinor: Minor;
  categoryCount: number;
  settledCategoryCount: number;
  fullyFundedCategoryCount: number;
}

/** Roll every category up into the numbers shown on the board header. */
export function summariseBoard(summaries: readonly CategorySummary[]): BoardTotals {
  let planned = 0;
  let funded = 0;
  let paid = 0;
  let settled = 0;
  let fullyFunded = 0;

  for (const summary of summaries) {
    planned += summary.totalMinor;
    funded += summary.fundedMinor;
    paid += summary.paidMinor;
    if (summary.isSettled) settled += 1;
    if (summary.isFullyFunded) fullyFunded += 1;
  }

  return {
    plannedMinor: planned,
    fundedMinor: funded,
    paidMinor: paid,
    outstandingMinor: planned - paid,
    categoryCount: summaries.length,
    settledCategoryCount: settled,
    fullyFundedCategoryCount: fullyFunded,
  };
}

/**
 * Money left after every planned rupee is accounted for.
 * Negative means the plan exceeds income — the number the user most needs.
 */
export function disposableIncome(incomeMinor: Minor, plannedMinor: Minor): Minor {
  return incomeMinor - plannedMinor;
}

export interface Ratios {
  /** Share of income committed to categories flagged as debt. */
  loanPct: number;
  /** Share of income going to everything else. */
  livingPct: number;
  /** Share left over. */
  freePct: number;
  disposableMinor: Minor;
}

/**
 * The spreadsheet's "Others Info" block, generalised. Returns zeros rather
 * than NaN when income is zero, so the UI never guards a divide.
 */
export function calculateRatios(params: {
  incomeMinor: Minor;
  loanMinor: Minor;
  livingMinor: Minor;
}): Ratios {
  const { incomeMinor, loanMinor, livingMinor } = params;
  const disposable = incomeMinor - loanMinor - livingMinor;

  return {
    loanPct: percentOf(loanMinor, incomeMinor),
    livingPct: percentOf(livingMinor, incomeMinor),
    freePct: percentOf(disposable, incomeMinor),
    disposableMinor: disposable,
  };
}

/** "YYYY-MM" key for a date — the period all state is bucketed by. */
export function periodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Parse a "YYYY-MM" key back to the first day of that month. */
export function periodToDate(period: string): Date {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, 1);
}

/** Shift a period by whole months, e.g. previous month for the trend row. */
export function shiftPeriod(period: string, months: number): string {
  const date = periodToDate(period);
  date.setMonth(date.getMonth() + months);
  return periodKey(date);
}

/** Human label for a period key, e.g. "July 2026". */
export function formatPeriod(period: string): string {
  return periodToDate(period).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The actual calendar date a due-day falls on within a period. Days beyond the
 * month's length clamp to its last day, so "due on the 31st" still resolves in
 * February rather than rolling into March.
 */
/**
 * Sentinel day meaning "no fixed date" — the bill is paid whenever, so it
 * never becomes overdue and is left out of due-date reminders.
 */
export const FLEXIBLE_DUE_DAY = 0;

/** True when a bill has no fixed payment date. */
export function isFlexibleDueDay(dueDay: number | null | undefined): boolean {
  return dueDay === FLEXIBLE_DUE_DAY;
}

export function dueDateFor(period: string, dueDay: number): Date {
  const base = periodToDate(period);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(Math.max(1, dueDay), lastDay));
}

/**
 * How a still-unpaid line sits relative to today: already overdue, due within
 * the next week, or simply upcoming. Drives the dashboard's reminder list,
 * which is the product's reason to exist — the user forgets whether a payment
 * went out.
 */
export type DueUrgency = 'overdue' | 'due_soon' | 'upcoming';

export function urgencyFor(dueDate: Date, today: Date): DueUrgency {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const days = Math.round((startOfDay(dueDate) - startOfDay(today)) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_soon';
  return 'upcoming';
}

// ----------------------------------------------------- saving plans

/**
 * A large bill paid at a future date that you save toward monthly — vehicle
 * insurance, a 6-month subscription, a credit-card installment plan.
 *
 * The user may know either side of the equation, so both are supported:
 *   - total + due date  -> the monthly set-aside is derived
 *   - monthly + term    -> the total and due date are derived
 * Whichever they enter, the stored shape is always total + due date, and the
 * monthly figure is recomputed from what is *left* to save, so falling behind
 * one month raises the following months rather than silently under-funding.
 */
export interface SavingPlan {
  targetMinor: Minor;
  dueDate: Date;
  startDate: Date;
}

export interface SavingPlanProgress {
  targetMinor: Minor;
  /** Set aside so far. */
  savedMinor: Minor;
  /** Still to collect; never negative. */
  remainingMinor: Minor;
  /** Whole months from today until the due date; 0 once due. */
  monthsRemaining: number;
  /** What to set aside this month to stay on track. */
  monthlyMinor: Minor;
  /** 0-100, clamped — safe for progress bars. */
  progressPct: number;
  /** Days until the bill is due; negative once overdue. */
  daysUntilDue: number;
  isComplete: boolean;
  isOverdue: boolean;
}

/**
 * Whole months between two dates, rounded up and floored at zero — the number
 * of contributions still available before the due date.
 */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  // A due date later in the same month still leaves one contribution.
  const partial = to.getDate() > from.getDate() ? 1 : 0;
  return Math.max(0, months + partial);
}

/**
 * Derive the monthly set-aside and progress for a plan, given what has been
 * saved so far. Dividing the *remaining* amount by the *remaining* months
 * keeps the plan self-correcting.
 */
export function savingPlanProgress(
  plan: SavingPlan,
  savedMinor: Minor,
  today = new Date(),
): SavingPlanProgress {
  const remaining = Math.max(0, plan.targetMinor - savedMinor);
  const monthsRemaining = monthsBetween(today, plan.dueDate);
  const days = daysUntil(plan.dueDate, today);

  return {
    targetMinor: plan.targetMinor,
    savedMinor,
    remainingMinor: remaining,
    monthsRemaining,
    // With no months left, the whole remainder is due now.
    monthlyMinor: monthsRemaining > 0 ? Math.ceil(remaining / monthsRemaining) : remaining,
    progressPct:
      plan.targetMinor > 0
        ? Math.min(100, Math.max(0, (savedMinor / plan.targetMinor) * 100))
        : 0,
    daysUntilDue: days,
    isComplete: remaining === 0,
    isOverdue: days < 0 && remaining > 0,
  };
}

/**
 * Build a plan from "I pay X per month for N months", the other entry mode.
 * Starts today and runs N whole months forward.
 */
export function planFromMonthly(
  monthlyMinor: Minor,
  months: number,
  startDate = new Date(),
): SavingPlan {
  const dueDate = new Date(startDate);
  dueDate.setMonth(dueDate.getMonth() + Math.max(1, Math.round(months)));
  return {
    targetMinor: monthlyMinor * Math.max(1, Math.round(months)),
    dueDate,
    startDate,
  };
}

/** True when a plan's due date is close enough to warn about. */
export function isPlanExpiringSoon(
  plan: SavingPlan,
  remindDaysBefore: number,
  today = new Date(),
): boolean {
  const days = daysUntil(plan.dueDate, today);
  return days >= 0 && days <= remindDaysBefore;
}

/** Whole days from `today` to `dueDate`; negative once past due. */
export function daysUntil(dueDate: Date, today: Date): number {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDay(dueDate) - startOfDay(today)) / 86_400_000);
}
