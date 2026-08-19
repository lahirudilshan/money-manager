/** Utility meter readings. */

import { asc, eq } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  meterReadings,
  type MeterReading,
  type NewMeterReading,
} from '~/db/schema';
import { createId, now } from './internal';

/**
 * Meter readings taken off utility statements — see `meterReadings` in schema.
 */
export const meterReadingRepo = {
  /** One account's history, oldest first — the order a chart plots in. */
  byAccount(accountNumber: string): MeterReading[] {
    return db
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.accountNumber, accountNumber))
      .orderBy(asc(meterReadings.period))
      .all();
  },

  /**
   * Record a statement's reading, replacing any already held for that period.
   *
   * Upsert rather than insert because the same statement genuinely arrives
   * twice — the user forwards it, and a Shortcut may re-share the whole inbox.
   * Inserting blindly would draw one month as two bars, and the unique index on
   * (account, period) would throw on the second write regardless.
   */
  record(input: Omit<NewMeterReading, 'id'> & { id?: string }): void {
    db.insert(meterReadings)
      .values({ ...input, id: input.id ?? createId() })
      .onConflictDoUpdate({
        target: [meterReadings.accountNumber, meterReadings.period],
        set: {
          units: input.units,
          readingCurrent: input.readingCurrent,
          readingPrevious: input.readingPrevious,
          readingDate: input.readingDate,
          totalDueMinor: input.totalDueMinor,
          monthlyBillMinor: input.monthlyBillMinor,
          updatedAt: now(),
        },
      })
      .run();
  },
};
