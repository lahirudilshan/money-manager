/** Common tracker mini-app: things you replace, and how long each one lasted. */

import { asc, desc, eq } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  refills,
  trackedItems,
  type NewRefill,
  type NewTrackedItem,
  type RefillRow,
  type TrackedItem,
} from '~/db/schema';
import { createId, now } from './internal';

export const trackedItemRepo = {
  /**
   * Active items first, then archived — both in name order.
   *
   * Archived rows are returned rather than filtered out here: the list screen
   * hides them behind a toggle, and a query that dropped them would make the
   * price history they hold unreachable.
   */
  all(): TrackedItem[] {
    return db
      .select()
      .from(trackedItems)
      .orderBy(asc(trackedItems.archived), asc(trackedItems.name))
      .all();
  },

  byId(id: string): TrackedItem | undefined {
    return db.select().from(trackedItems).where(eq(trackedItems.id, id)).get();
  },

  create(input: Omit<NewTrackedItem, 'id'> & { id?: string }): TrackedItem {
    return db
      .insert(trackedItems)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewTrackedItem>): TrackedItem | undefined {
    return db
      .update(trackedItems)
      .set({ ...patch, updatedAt: now() })
      .where(eq(trackedItems.id, id))
      .returning()
      .get();
  },

  /**
   * Stop tracking without losing the record.
   *
   * The history took months of refills to accumulate and cannot be recreated,
   * so "I don't use this any more" archives rather than deletes.
   */
  archive(id: string, archived = true): TrackedItem | undefined {
    return trackedItemRepo.update(id, { archived });
  },

  /** Deletes the item AND its refills, via the foreign key's cascade. */
  remove(id: string): void {
    db.delete(trackedItems).where(eq(trackedItems.id, id)).run();
  },
};

export const refillRepo = {
  /** One item's refills, newest first — the order the history screen reads in. */
  forItem(itemId: string): RefillRow[] {
    return db
      .select()
      .from(refills)
      .where(eq(refills.itemId, itemId))
      .orderBy(desc(refills.filledOn))
      .all();
  },

  /** Every refill across every item, for the dashboard's due sweep. */
  all(): RefillRow[] {
    return db.select().from(refills).orderBy(desc(refills.filledOn)).all();
  },

  byId(id: string): RefillRow | undefined {
    return db.select().from(refills).where(eq(refills.id, id)).get();
  },

  create(input: Omit<NewRefill, 'id'> & { id?: string }): RefillRow {
    return db
      .insert(refills)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewRefill>): RefillRow | undefined {
    return db
      .update(refills)
      .set({ ...patch, updatedAt: now() })
      .where(eq(refills.id, id))
      .returning()
      .get();
  },

  remove(id: string): void {
    db.delete(refills).where(eq(refills.id, id)).run();
  },
};
