/** Wording shared by the buddy-loan screens and the dashboard card. */

import type { BuddyLoanDirection, BuddyLoanStatus, BuddyUrgency } from './buddyLoans';

/**
 * How a due date reads on a card.
 *
 * Phrased from the reader's point of view rather than as a raw count: "due
 * tomorrow" is what a person thinks, "due in 1 day" is what a computer thinks.
 * Overdue is stated in days late rather than as a negative number for the same
 * reason.
 */
export function describeDue(days: number): string {
  if (days < -1) return `${Math.abs(days)} days late`;
  if (days === -1) return 'a day late';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days <= 30) return `due in ${days} days`;

  const months = Math.round(days / 30);
  return months <= 1 ? 'due in a month' : `due in ${months} months`;
}

/** How long ago the money went out, for a record with no promised date. */
export function describeAge(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.round(days / 30);
  return months <= 1 ? 'a month ago' : `${months} months ago`;
}

/**
 * The verb for a record, which depends on which way the money went.
 *
 * "I gave" / "I took" rather than "lent" / "borrowed". The book holds both
 * kinds and the two were easy to confuse at a glance — a row reading "Borrowed
 * LKR 7,500" does not say WHO borrowed it. Gave and took are unambiguous about
 * the direction because they are stated from the phone owner's side.
 */
export function directionVerb(direction: BuddyLoanDirection): string {
  return direction === 'lent' ? 'I gave' : 'I took';
}

/**
 * Who is waiting for the money, in a phrase that finishes a sentence.
 *
 * Used wherever a row must make the direction plain without room for a label —
 * "Nuwan · owes me" against "Ruwan · I owe them".
 */
export function directionOwes(direction: BuddyLoanDirection): string {
  return direction === 'lent' ? 'owes me' : 'I owe them';
}

/** Heading for a group of records going one way. */
export function directionHeading(direction: BuddyLoanDirection): string {
  return direction === 'lent' ? 'Money I gave' : 'Money I took';
}

/**
 * The one-word state shown on a chip.
 *
 * "Written off" rather than "lost" or "bad debt": the user made a decision, and
 * the label should report it plainly without editorialising about the person.
 */
export const STATUS_LABEL: Record<BuddyLoanStatus, string> = {
  outstanding: 'Outstanding',
  paid: 'Settled',
  written_off: 'Written off',
};

/** Which tone a status chip takes — see the theme's semantic colours. */
export function statusTone(status: BuddyLoanStatus): 'good' | 'warn' | 'muted' {
  if (status === 'paid') return 'good';
  if (status === 'written_off') return 'muted';
  return 'warn';
}

/** Tone for a due date, matching the bill reminders' three bands. */
export function urgencyTone(urgency: BuddyUrgency): 'bad' | 'warn' | 'muted' {
  if (urgency === 'overdue') return 'bad';
  if (urgency === 'due_soon') return 'warn';
  return 'muted';
}
