/** Buddy loans mini-app: money lent to people, and what came back. */

import { asc, desc, eq } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  buddyLoans,
  buddyRepayments,
  type BuddyLoan,
  type BuddyRepayment,
  type NewBuddyLoan,
  type NewBuddyRepayment,
} from '~/db/schema';
import { createId, now } from './internal';

export const buddyLoanRepo = {
  /**
   * Every record, newest lending first.
   *
   * Not filtered by status: the add-on's list shows settled and written-off
   * rows too, because "who did I lend to and did it come back" is the whole
   * point of keeping a book. The screen groups them; the query does not hide
   * them.
   */
  all(): BuddyLoan[] {
    return db.select().from(buddyLoans).orderBy(desc(buddyLoans.lentOn)).all();
  },

  byId(id: string): BuddyLoan | undefined {
    return db.select().from(buddyLoans).where(eq(buddyLoans.id, id)).get();
  },

  create(input: Omit<NewBuddyLoan, 'id'> & { id?: string }): BuddyLoan {
    return db
      .insert(buddyLoans)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewBuddyLoan>): BuddyLoan | undefined {
    return db
      .update(buddyLoans)
      .set({ ...patch, updatedAt: now() })
      .where(eq(buddyLoans.id, id))
      .returning()
      .get();
  },

  /**
   * Close a loan, recording WHEN as well as how.
   *
   * `closedOn` is set here rather than left to each caller, so a settled record
   * can never end up without the date it was settled on — which is the one
   * thing the history is for.
   */
  close(id: string, status: 'paid' | 'written_off', closedOn = new Date()): BuddyLoan | undefined {
    return buddyLoanRepo.update(id, { status, closedOn });
  },

  /** Move a closed record back to outstanding, clearing the closing date. */
  reopen(id: string): BuddyLoan | undefined {
    return buddyLoanRepo.update(id, { status: 'outstanding', closedOn: null });
  },

  /** Repayments cascade with the loan — see the foreign key in schema.ts. */
  remove(id: string): void {
    db.delete(buddyLoans).where(eq(buddyLoans.id, id)).run();
  },
};

export const buddyRepaymentRepo = {
  /** Every repayment, across all loans — the store groups them by loan id. */
  all(): BuddyRepayment[] {
    return db.select().from(buddyRepayments).orderBy(asc(buddyRepayments.paidOn)).all();
  },

  byLoan(loanId: string): BuddyRepayment[] {
    return db
      .select()
      .from(buddyRepayments)
      .where(eq(buddyRepayments.loanId, loanId))
      .orderBy(asc(buddyRepayments.paidOn))
      .all();
  },

  create(input: Omit<NewBuddyRepayment, 'id'> & { id?: string }): BuddyRepayment {
    return db
      .insert(buddyRepayments)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  remove(id: string): void {
    db.delete(buddyRepayments).where(eq(buddyRepayments.id, id)).run();
  },
};
