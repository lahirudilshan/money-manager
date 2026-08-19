/** Loan rows. The board line's installment is derived from these. */

import { eq } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  loans,
  type Loan,
  type NewLoan,
} from '~/db/schema';
import { createId, now } from './internal';

export const loanRepo = {
  all(): Loan[] {
    return db.select().from(loans).where(eq(loans.isActive, true)).all();
  },
  byId(id: string): Loan | undefined {
    return db.select().from(loans).where(eq(loans.id, id)).get();
  },
  create(input: Omit<NewLoan, 'id'> & { id?: string }): Loan {
    return db
      .insert(loans)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },
  update(id: string, patch: Partial<NewLoan>): Loan | undefined {
    return db
      .update(loans)
      .set({ ...patch, updatedAt: now() })
      .where(eq(loans.id, id))
      .returning()
      .get();
  },
  remove(id: string): void {
    db.delete(loans).where(eq(loans.id, id)).run();
  },
};
