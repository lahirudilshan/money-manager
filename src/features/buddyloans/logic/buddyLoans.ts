/**
 * Money lent to people, and whether it came back.
 *
 * Deliberately NOT the `loans` feature. That one models a bank product —
 * principal, interest rate, an amortisation schedule, a fixed installment. This
 * is the opposite: a friend asked for 5,000 in cash, said they would return it
 * "next month", and the only facts worth storing are who, how much, when it
 * went out, and what has come back since.
 *
 * Everything here is pure arithmetic over plain values so it is testable
 * without a database or a screen.
 */

import type { Minor } from '~/shared/lib/money';

/** Where a debt stands. `written_off` is an outcome, not a failure to record. */
export type BuddyLoanStatus = 'outstanding' | 'paid' | 'written_off';

/** Which way the money went. */
export type BuddyLoanDirection = 'lent' | 'borrowed';

/** One repayment against a debt. */
export interface BuddyRepayment {
  id: string;
  amountMinor: Minor;
  paidOn: Date;
}

/** The stored record, as the logic here needs to see it. */
export interface BuddyLoanLike {
  id: string;
  personName: string;
  amountMinor: Minor;
  direction: BuddyLoanDirection;
  lentOn: Date;
  /** Optional: plenty of these are lent with no promised date at all. */
  dueOn: Date | null;
  status: BuddyLoanStatus;
}

/**
 * What is still owed on a debt.
 *
 * Derived from the repayments every time rather than stored as a running
 * balance. A stored total is one write away from disagreeing with the rows
 * beneath it — delete a repayment and the balance is silently wrong — and this
 * is cheap: a person has a handful of these, not thousands.
 *
 * Clamped at zero so an over-payment (they rounded up, or paid twice) reads as
 * settled rather than as the lender owing money back.
 */
export function remainingMinor(
  loan: Pick<BuddyLoanLike, 'amountMinor' | 'status'>,
  repayments: readonly BuddyRepayment[],
): Minor {
  // Written off means nothing more is expected, whatever the arithmetic says.
  if (loan.status === 'written_off') return 0;

  const repaid = repayments.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const left = loan.amountMinor - repaid;
  return left > 0 ? left : 0;
}

/** Total repaid so far. */
export function repaidMinor(repayments: readonly BuddyRepayment[]): Minor {
  return repayments.reduce((sum, entry) => sum + entry.amountMinor, 0);
}

/**
 * Whether the repayments now cover the whole debt.
 *
 * Used to settle a loan automatically when the last part payment lands, so the
 * user is never left with a record showing "LKR 0 remaining" that still counts
 * as outstanding.
 */
export function isFullyRepaid(
  loan: Pick<BuddyLoanLike, 'amountMinor'>,
  repayments: readonly BuddyRepayment[],
): boolean {
  return repaidMinor(repayments) >= loan.amountMinor;
}

/**
 * How many whole days ago something happened. Never negative.
 *
 * A named counterpart to `daysUntil` rather than callers negating it, because
 * getting the argument order backwards there reads perfectly well and is wrong:
 * the list showed every loan as lent "today" however old it was, since
 * `daysUntil(today, lentOn)` measures the wrong direction.
 */
export function daysSince(past: Date, today: Date): number {
  const days = daysUntil(today, past);
  return days > 0 ? days : 0;
}

/** Whole days from `today` until `due`, negative once it is past. */
export function daysUntil(due: Date, today: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((startOfDay(due) - startOfDay(today)) / MS_PER_DAY);
}

/** How loudly a debt is asking to be chased. */
export type BuddyUrgency = 'overdue' | 'due_soon' | 'upcoming';

/**
 * Urgency from the promised date.
 *
 * The same three bands the bill reminders use, so a friend's loan and an
 * electricity bill sitting in one "Coming up" list are ranked by the same rule
 * and neither looks more urgent than it is.
 */
export function urgencyOf(days: number): BuddyUrgency {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_soon';
  return 'upcoming';
}

/**
 * The debts that belong in the dashboard's "Coming up" section.
 *
 * Three exclusions, each deliberate:
 *
 *   - Settled and written-off records. Nothing is owed, so a reminder would be
 *     a false alarm — the exact thing that teaches people to ignore a section.
 *   - Records with NO due date. The user said this is common ("sometime not
 *     return"), and inventing a deadline for one produces a reminder about a
 *     promise nobody made. They stay visible in the add-on's own list instead.
 *   - Money the user BORROWED rather than lent, which is handled below.
 *
 * Borrowed money is included, because a debt the user owes is at least as
 * worth reminding about as one owed to them — but it is returned with its
 * direction intact so the card can word itself correctly.
 */
export function dueBuddyLoans<T extends BuddyLoanLike>(
  loans: readonly T[],
  repaymentsByLoan: ReadonlyMap<string, readonly BuddyRepayment[]>,
  today: Date,
): { loan: T; remainingMinor: Minor; daysUntil: number; urgency: BuddyUrgency }[] {
  const due: { loan: T; remainingMinor: Minor; daysUntil: number; urgency: BuddyUrgency }[] = [];

  for (const loan of loans) {
    if (loan.status !== 'outstanding') continue;
    if (!loan.dueOn) continue;

    const remaining = remainingMinor(loan, repaymentsByLoan.get(loan.id) ?? []);
    // Fully covered by part payments but not yet marked settled — nothing left
    // to chase, so it does not belong on the dashboard.
    if (remaining <= 0) continue;

    const days = daysUntil(loan.dueOn, today);
    due.push({ loan, remainingMinor: remaining, daysUntil: days, urgency: urgencyOf(days) });
  }

  // Soonest first, so the most overdue leads and the list reads as a queue.
  return due.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Headline figures for the add-on's own screen. */
export interface BuddyTotals {
  /** Still owed to the user across every outstanding loan. */
  outstandingMinor: Minor;
  /** Recovered so far, across every loan including settled ones. */
  repaidMinor: Minor;
  /** Given up on — kept separate so it never flatters the recovery figure. */
  writtenOffMinor: Minor;
  /** Money the USER owes, kept apart from money owed to them. */
  owedByMeMinor: Minor;
}

/**
 * Totals across the whole book.
 *
 * Written-off money is reported on its own line rather than folded into either
 * of the others. Counting it as repaid would overstate what actually came back;
 * counting it as outstanding would keep chasing something the user has already
 * decided is gone. It is neither, and the honest summary says so.
 */
export function buddyTotals(
  loans: readonly BuddyLoanLike[],
  repaymentsByLoan: ReadonlyMap<string, readonly BuddyRepayment[]>,
): BuddyTotals {
  let outstanding = 0;
  let repaid = 0;
  let writtenOff = 0;
  let owedByMe = 0;

  for (const loan of loans) {
    const repayments = repaymentsByLoan.get(loan.id) ?? [];
    repaid += repaidMinor(repayments);

    if (loan.status === 'written_off') {
      // What was never recovered, not the whole original amount — a debt part
      // repaid and then written off only lost the remainder.
      const lost = loan.amountMinor - repaidMinor(repayments);
      writtenOff += lost > 0 ? lost : 0;
      continue;
    }

    if (loan.status !== 'outstanding') continue;

    const left = remainingMinor(loan, repayments);
    if (loan.direction === 'borrowed') owedByMe += left;
    else outstanding += left;
  }

  return {
    outstandingMinor: outstanding,
    repaidMinor: repaid,
    writtenOffMinor: writtenOff,
    owedByMeMinor: owedByMe,
  };
}

/**
 * How far above the outstanding balance a repayment may still be accepted.
 *
 * People round up — "you owe 4,850, here's 5,000, keep it" — and refusing that
 * would make the app wrong about a transaction that really happened. A slipped
 * digit is an order of magnitude out, not a few hundred rupees, so the two are
 * easy to separate: allow a little, reject a lot.
 *
 * Expressed as BOTH a ratio and a floor, because neither alone works across the
 * range. 10% of a 200-rupee loan is 20 rupees, too tight to round with; a flat
 * 500 allowance on a 2,000,000 loan is meaninglessly small. Whichever is more
 * generous wins.
 */
const ROUNDING_TOLERANCE = 0.1;
const ROUNDING_FLOOR_MINOR = 50_000;

/**
 * Whether a repayment can be logged against the balance still owed.
 *
 * Returns the reason it cannot, or null. The arithmetic elsewhere clamps a
 * runaway figure to zero, so nothing LOOKS broken afterwards — the repayment
 * list simply claims someone paid ten times what they borrowed, which is
 * exactly the kind of quiet wrongness a book of who-owes-what cannot afford.
 */
export function validateRepayment(amountMinor: number, remainingMinor: number): string | null {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 'Enter an amount';

  const allowance = Math.max(remainingMinor * ROUNDING_TOLERANCE, ROUNDING_FLOOR_MINOR);
  if (amountMinor > remainingMinor + allowance) return 'That is more than they still owe';

  return null;
}

/**
 * Whether a loan's amount can be edited to `amountMinor`.
 *
 * Correcting the figure downward is normal — the amount was mistyped, or the
 * user misremembered. Correcting it BELOW what has already been repaid is not:
 * it leaves a record in which someone paid back more than they ever borrowed.
 * The edit is usually the right number and an earlier repayment the wrong one,
 * but the app has no way to know which, so it says so rather than storing the
 * contradiction silently.
 */
export function validateLoanAmount(amountMinor: number, alreadyRepaidMinor: number): string | null {
  if (alreadyRepaidMinor > 0 && amountMinor < alreadyRepaidMinor) {
    return 'They have already paid back more than this';
  }
  return null;
}

/**
 * The people you have lent to before, most recent first.
 *
 * Lending is repetitive in a way the form did not exploit: it is the same
 * handful of friends, neighbours and relatives over and over, and every new
 * loan asked the user to type a name they had already typed. Offering the
 * recent ones turns the commonest case into a single tap.
 *
 * Ordered by RECENCY rather than by how much is outstanding or how often they
 * appear. The person you lent to last week is overwhelmingly the likeliest one
 * you are lending to now — a frequency ranking would bury a new friend behind
 * a relative you settled up with months ago.
 *
 * Names are compared case-insensitively so "Nuwan" and "nuwan" collapse to one
 * suggestion, but the ORIGINAL spelling is what comes back: the user's own
 * capitalisation is the right answer, and normalising it would quietly rewrite
 * their contact's name.
 */
export function recentPeople(loans: readonly BuddyLoanLike[], limit = 6): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  const byRecency = [...loans].sort((a, b) => b.lentOn.getTime() - a.lentOn.getTime());

  for (const loan of byRecency) {
    const name = loan.personName.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
    if (names.length >= limit) break;
  }

  return names;
}

/**
 * What this person still owes across every loan they have open.
 *
 * Shown beside a suggestion so picking a name is an informed choice rather than
 * a blind one — "Kasun (owes 9,000)" is a materially different decision from
 * "Kasun", and it is exactly the fact someone about to lend again wants.
 */
export function outstandingForPerson(
  loans: readonly BuddyLoanLike[],
  repaymentsByLoan: ReadonlyMap<string, readonly BuddyRepayment[]>,
  personName: string,
): Minor {
  const key = personName.trim().toLowerCase();
  let total = 0;

  for (const loan of loans) {
    if (loan.status !== 'outstanding') continue;
    if (loan.direction !== 'lent') continue;
    if (loan.personName.trim().toLowerCase() !== key) continue;
    total += remainingMinor(loan, repaymentsByLoan.get(loan.id) ?? []);
  }

  return total;
}

/**
 * A stable colour for a person, derived from their name.
 *
 * Every avatar being the add-on's one accent made a row of chips — and a list
 * of loans — read as a block of identical circles, so telling Nuwan from Kasun
 * meant reading both. Giving each person their own tint makes the list
 * scannable by shape and colour before any text is read, which is how someone
 * actually finds a name they already know is there.
 *
 * DERIVED, not stored. A colour column would need picking at creation, would
 * differ between two loans to the same person typed slightly differently, and
 * would be one more thing to migrate. Hashing the name means the same person is
 * always the same colour, on every screen, with nothing to keep in sync.
 *
 * Case- and space-insensitive, so "nuwan" and "Nuwan " are one person here just
 * as they are in `recentPeople`.
 */
export function personColor(name: string, palette: readonly string[]): string {
  const key = name.trim().toLowerCase();
  if (key.length === 0 || palette.length === 0) return palette[0] ?? '#0F6FDE';

  /*
   * djb2, a small non-cryptographic string hash.
   *
   * Chosen over summing char codes, which collides badly on names that are
   * anagrams or differ by one letter — exactly the case here, where a family's
   * names are short and share letters. `>>> 0` keeps it unsigned so the modulo
   * cannot come back negative.
   */
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }

  return palette[hash % palette.length];
}
