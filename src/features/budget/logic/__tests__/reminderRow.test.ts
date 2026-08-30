import { describe, expect, it } from 'vitest';
import { isOngoing } from '~/db/schema';
import type { SubcategoryFrequency } from '~/db/schema';

/**
 * What belongs in the dashboard's due-date reminders, and for how much.
 *
 * Two bugs met on one row — a "Food" spending budget reading
 * "2 days overdue · LKR 0" — and each is pinned separately below.
 */

/** The reminder filter: which lines can ever be "due". */
function isReminderCandidate(
  frequency: SubcategoryFrequency,
  type: 'income' | 'expense',
  status: 'pending' | 'paid',
): boolean {
  if (type === 'income') return false;
  if (isOngoing(frequency)) return false;
  return status !== 'paid';
}

/** The amount a reminder shows. */
function reminderAmount(actualMinor: number | null, plannedMinor: number): number {
  return actualMinor || plannedMinor;
}

describe('which lines can be overdue', () => {
  /**
   * The bug on screen.
   *
   * A spending budget is never ticked "paid" as a whole — its spend is the
   * running sum of its entries — so once its due day passed it could never
   * leave the list. "Food · 2 days overdue" was permanent, and a section that
   * cries wolf is one people stop reading.
   */
  it('never treats a spending budget as due', () => {
    expect(isReminderCandidate('ongoing', 'expense', 'pending')).toBe(false);
  });

  it('still reminds about real bills', () => {
    expect(isReminderCandidate('monthly', 'expense', 'pending')).toBe(true);
    expect(isReminderCandidate('yearly', 'expense', 'pending')).toBe(true);
    expect(isReminderCandidate('one_time', 'expense', 'pending')).toBe(true);
  });

  it('drops a bill once it is paid', () => {
    expect(isReminderCandidate('monthly', 'expense', 'paid')).toBe(false);
  });

  /** Income arrives on its own; there is nothing to chase. */
  it('ignores income lines', () => {
    expect(isReminderCandidate('monthly', 'income', 'pending')).toBe(false);
  });
});

describe('the amount a reminder shows', () => {
  /**
   * The "LKR 0" half of the bug.
   *
   * This read `actualMinor ?? plannedMinor`, and zero is not nullish — so a
   * line with a logged actual of 0 showed "LKR 0" rather than what is still
   * planned. A bill can legitimately be logged at zero (a waived charge), and
   * the reminder should then fall back to the plan.
   */
  it('falls back to the plan when the actual is zero', () => {
    expect(reminderAmount(0, 20_000_00)).toBe(20_000_00);
  });

  it('uses the actual when one was really logged', () => {
    expect(reminderAmount(18_500_00, 20_000_00)).toBe(18_500_00);
  });

  it('uses the plan when no actual exists', () => {
    expect(reminderAmount(null, 20_000_00)).toBe(20_000_00);
  });

  /** Both zero is genuinely zero — nothing to fall back to. */
  it('reports zero when there is no plan either', () => {
    expect(reminderAmount(0, 0)).toBe(0);
  });
});
