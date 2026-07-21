import { percentOf, sumMinor, type Minor } from './money';

/**
 * The funding-board domain logic, as pure functions.
 *
 * A category holds subcategories. The category is assigned a card, its
 * total is transferred onto that card, and each subcategory is then walked
 * through pending -> transferred -> completed.
 */

export type CategoryStatus = 'pending' | 'transferred' | 'completed';

/** Canonical order — also the order the status chip cycles through. */
export const STATUS_ORDER: CategoryStatus[] = ['pending', 'transferred', 'completed'];

export interface PlannedCategory {
  id: string;
  name: string;
  plannedMinor: Minor;
  /** Overrides plannedMinor when the real amount differed. */
  actualMinor?: Minor | null;
  status: CategoryStatus;
}

/** Amount that actually counts for a category — actual if set, else planned. */
export function effectiveAmount(category: PlannedCategory): Minor {
  return category.actualMinor ?? category.plannedMinor;
}

/**
 * Advance a status one step. Completed is terminal under tapping, so it wraps
 * back to pending — the user needs a way to undo a mis-tap without a menu.
 */
export function nextStatus(current: CategoryStatus): CategoryStatus {
  const index = STATUS_ORDER.indexOf(current);
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
}

/** True once money has been moved, whether or not the bill is paid. */
export function isFunded(status: CategoryStatus): boolean {
  return status === 'transferred' || status === 'completed';
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
  /** Value of subcategories marked completed. */
  completedMinor: Minor;
  /** Value still awaiting payment (pending + transferred). */
  outstandingMinor: Minor;
  counts: Record<CategoryStatus, number>;
  subcategoryCount: number;
  /** True when every subcategory is completed (and there is at least one). */
  isSettled: boolean;
  /** True when transfers cover the full plan. */
  isFullyFunded: boolean;
}

export function summariseCategory(
  subcategories: readonly PlannedCategory[],
  fundedMinor: Minor,
): CategorySummary {
  const total = sumMinor(subcategories.map(effectiveAmount));

  const counts: Record<CategoryStatus, number> = {
    pending: 0,
    transferred: 0,
    completed: 0,
  };

  let completed = 0;
  for (const subcategory of subcategories) {
    counts[subcategory.status] += 1;
    if (subcategory.status === 'completed') completed += effectiveAmount(subcategory);
  }

  const difference = fundedMinor - total;

  return {
    totalMinor: total,
    fundedMinor,
    shortfallMinor: Math.max(0, -difference),
    surplusMinor: Math.max(0, difference),
    fundedPct: total > 0 ? Math.min(100, Math.max(0, percentOf(fundedMinor, total))) : 0,
    completedMinor: completed,
    outstandingMinor: total - completed,
    counts,
    subcategoryCount: subcategories.length,
    isSettled: subcategories.length > 0 && counts.completed === subcategories.length,
    isFullyFunded: total > 0 && fundedMinor >= total,
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
  completedMinor: Minor;
  outstandingMinor: Minor;
  categoryCount: number;
  settledCategoryCount: number;
  fullyFundedCategoryCount: number;
}

/** Roll every category up into the numbers shown on the board header. */
export function summariseBoard(summaries: readonly CategorySummary[]): BoardTotals {
  let planned = 0;
  let funded = 0;
  let completed = 0;
  let settled = 0;
  let fullyFunded = 0;

  for (const summary of summaries) {
    planned += summary.totalMinor;
    funded += summary.fundedMinor;
    completed += summary.completedMinor;
    if (summary.isSettled) settled += 1;
    if (summary.isFullyFunded) fullyFunded += 1;
  }

  return {
    plannedMinor: planned,
    fundedMinor: funded,
    completedMinor: completed,
    outstandingMinor: planned - completed,
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
