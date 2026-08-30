/**
 * Repositories for the funding board: accounts, houses, groups, lines, their
 * per-period state, funding moves and income.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  cards,
  categories,
  categoryStates,
  fundings,
  houses,
  incomes,
  subcategories,
  subcategoryStates,
  transactions,
  transactionSplits,
  type Card,
  type Category,
  type CategoryFundingStatus,
  type CategoryState,
  type Funding,
  type House,
  type Income,
  type NewCard,
  type NewCategory,
  type NewFunding,
  type NewHouse,
  type NewIncome,
  type NewSubcategory,
  type NewTransaction,
  type Subcategory,
  type SubcategoryState,
  type SubcategoryStatus,
  type Transaction,
  type TransactionSplit,
} from '~/db/schema';
import { createId, now, readSubState } from './internal';

export const cardRepo = {
  all(): Card[] {
    return db
      .select()
      .from(cards)
      .where(isNull(cards.archivedAt))
      .orderBy(asc(cards.sortOrder))
      .all();
  },
  byId(id: string): Card | undefined {
    return db.select().from(cards).where(eq(cards.id, id)).get();
  },
  create(input: Omit<NewCard, 'id'> & { id?: string }): Card {
    return db
      .insert(cards)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },
  update(id: string, patch: Partial<NewCard>): Card | undefined {
    return db
      .update(cards)
      .set({ ...patch, updatedAt: now() })
      .where(eq(cards.id, id))
      .returning()
      .get();
  },
  remove(id: string): void {
    db.delete(cards).where(eq(cards.id, id)).run();
  },
};

/**
 * Properties whose bills the user pays — see `houses` in schema.ts.
 *
 * The only non-obvious rule lives in `setPrimary`: exactly one house may be the
 * user's own home, and it is enforced here rather than in the DDL because
 * SQLite cannot express "at most one row with is_primary = 1" as a constraint
 * that survives this codebase's `CREATE TABLE IF NOT EXISTS` approach.
 */
export const houseRepo = {
  all(): House[] {
    return db
      .select()
      .from(houses)
      .where(isNull(houses.archivedAt))
      .orderBy(asc(houses.sortOrder))
      .all();
  },
  byId(id: string): House | undefined {
    return db.select().from(houses).where(eq(houses.id, id)).get();
  },
  /** The user's own home, or undefined when none is marked. */
  primary(): House | undefined {
    return db
      .select()
      .from(houses)
      .where(and(eq(houses.isPrimary, true), isNull(houses.archivedAt)))
      .get();
  },
  create(input: Omit<NewHouse, 'id'> & { id?: string }): House {
    const created = db
      .insert(houses)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();

    // Creating a house AS primary must demote the incumbent, or two homes end
    // up flagged and every "which house by default" read becomes a coin toss.
    if (created.isPrimary) houseRepo.setPrimary(created.id);
    return created;
  },
  update(id: string, patch: Partial<NewHouse>): House | undefined {
    const updated = db
      .update(houses)
      .set({ ...patch, updatedAt: now() })
      .where(eq(houses.id, id))
      .returning()
      .get();

    if (patch.isPrimary) houseRepo.setPrimary(id);
    return updated;
  },
  /** Make `id` the one and only primary house. */
  setPrimary(id: string): void {
    db.update(houses)
      .set({ isPrimary: false, updatedAt: now() })
      .where(eq(houses.isPrimary, true))
      .run();
    db.update(houses).set({ isPrimary: true, updatedAt: now() }).where(eq(houses.id, id)).run();
  },
  /**
   * Remove a house. Payments that referenced it keep their history — the
   * `house_id` foreign keys are `set null`, so the money is never deleted along
   * with the label, which would silently change a month's totals.
   */
  remove(id: string): void {
    db.delete(houses).where(eq(houses.id, id)).run();
  },
  reorder(orderedIds: readonly string[]): void {
    orderedIds.forEach((id, index) => {
      db.update(houses)
        .set({ sortOrder: index, updatedAt: now() })
        .where(eq(houses.id, id))
        .run();
    });
  },
};

/** The primary object — funded as a unit, owns its own card/due day. */
export const categoryRepo = {
  all(): Category[] {
    return db
      .select()
      .from(categories)
      .where(isNull(categories.archivedAt))
      .orderBy(asc(categories.sortOrder))
      .all();
  },
  byId(id: string): Category | undefined {
    return db.select().from(categories).where(eq(categories.id, id)).get();
  },
  create(input: Omit<NewCategory, 'id'> & { id?: string }): Category {
    return db
      .insert(categories)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },
  update(id: string, patch: Partial<NewCategory>): Category | undefined {
    return db
      .update(categories)
      .set({ ...patch, updatedAt: now() })
      .where(eq(categories.id, id))
      .returning()
      .get();
  },
  remove(id: string): void {
    db.delete(categories).where(eq(categories.id, id)).run();
  },
  /** Persist a new top-level order — powers the board's drag-to-reorder. */
  reorder(orderedIds: readonly string[]): void {
    orderedIds.forEach((id, index) => {
      db.update(categories)
        .set({ sortOrder: index, updatedAt: now() })
        .where(eq(categories.id, id))
        .run();
    });
  },
};

/** The real budget line — plannedMinor, frequency, due day, card override, loan link. */
export const subcategoryRepo = {
  all(): Subcategory[] {
    return db
      .select()
      .from(subcategories)
      .where(isNull(subcategories.archivedAt))
      .orderBy(asc(subcategories.sortOrder))
      .all();
  },
  byCategory(categoryId: string): Subcategory[] {
    return db
      .select()
      .from(subcategories)
      .where(and(eq(subcategories.categoryId, categoryId), isNull(subcategories.archivedAt)))
      .orderBy(asc(subcategories.sortOrder))
      .all();
  },
  byId(id: string): Subcategory | undefined {
    return db.select().from(subcategories).where(eq(subcategories.id, id)).get();
  },
  create(input: Omit<NewSubcategory, 'id'> & { id?: string }): Subcategory {
    return db
      .insert(subcategories)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },
  update(id: string, patch: Partial<NewSubcategory>): Subcategory | undefined {
    return db
      .update(subcategories)
      .set({ ...patch, updatedAt: now() })
      .where(eq(subcategories.id, id))
      .returning()
      .get();
  },
  remove(id: string): void {
    db.delete(subcategories).where(eq(subcategories.id, id)).run();
  },
  /**
   * Persist a new order for the bills WITHIN one category.
   *
   * `sortOrder` is only ever compared between siblings (every query that reads
   * it is already scoped to a category), so the indexes restart at 0 for each
   * category rather than being unique board-wide. Callers pass one category's
   * ids; passing a mixed list would renumber lines against bills they are never
   * sorted against.
   */
  reorder(orderedIds: readonly string[]): void {
    orderedIds.forEach((id, index) => {
      db.update(subcategories)
        .set({ sortOrder: index, updatedAt: now() })
        .where(eq(subcategories.id, id))
        .run();
    });
  },
};

/**
 * Individual entries under an `ongoing` subcategory. Its per-period "actual"
 * is the SUM of these rows, so there is no single planned amount to store.
 */
export const transactionRepo = {
  /** All entries for one subcategory across every period, newest first. */
  bySubcategory(subcategoryId: string): Transaction[] {
    return db
      .select()
      .from(transactions)
      .where(eq(transactions.subcategoryId, subcategoryId))
      .orderBy(desc(transactions.date))
      .all();
  },

  /** Entries for one subcategory within a single period, newest first. */
  bySubcategoryPeriod(subcategoryId: string, period: string): Transaction[] {
    return db
      .select()
      .from(transactions)
      .where(and(eq(transactions.subcategoryId, subcategoryId), eq(transactions.period, period)))
      .orderBy(desc(transactions.date))
      .all();
  },

  /**
   * Total spent per ongoing subcategory for a period, computed in SQL. Used
   * as the subcategory's effective "actual" so the two can never disagree.
   *
   * ## Splits
   *
   * A split transaction is ONE payment allocated across several lines (see
   * `transactionSplits`), so its own `subcategoryId` is no longer the whole
   * story — counting it there would charge the full 5,000 to Groceries when
   * 2,000 of it was pet food, and counting it in both places would double the
   * month's spend.
   *
   * So the total is a union of two disjoint sets:
   *
   *   - UNSPLIT transactions, counted whole against their own line. The
   *     `NOT EXISTS` is what makes them disjoint: the moment a transaction
   *     gains parts it drops out of this half.
   *   - the PARTS of split transactions, each counted against the line it was
   *     allocated to.
   *
   * Since the parts of a split are required to sum to the parent's amount, the
   * grand total across all lines is unchanged by splitting — only its
   * distribution moves, which is exactly the intent.
   */
  totalsByPeriod(period: string): Map<string, number> {
    const rows = db.all<{ subcategory_id: string; total: number }>(sql`
      SELECT subcategory_id, SUM(amount_minor) AS total FROM (
        SELECT t.subcategory_id AS subcategory_id, t.amount_minor AS amount_minor
          FROM ${transactions} t
         WHERE t.period = ${period}
           AND NOT EXISTS (
             SELECT 1 FROM ${transactionSplits} s WHERE s.transaction_id = t.id
           )
        UNION ALL
        SELECT s.subcategory_id AS subcategory_id, s.amount_minor AS amount_minor
          FROM ${transactionSplits} s
          JOIN ${transactions} t ON t.id = s.transaction_id
         WHERE t.period = ${period}
      )
      GROUP BY subcategory_id
    `);
    return new Map(rows.map((row) => [row.subcategory_id, Number(row.total)]));
  },

  create(input: Omit<NewTransaction, 'id'> & { id?: string }): Transaction {
    return db
      .insert(transactions)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewTransaction>): Transaction | undefined {
    return db
      .update(transactions)
      .set({ ...patch, updatedAt: now() })
      .where(eq(transactions.id, id))
      .returning()
      .get();
  },

  remove(id: string): void {
    db.delete(transactions).where(eq(transactions.id, id)).run();
  },
};

/**
 * The parts of split transactions.
 *
 * Deliberately thin: a split is only ever written as a WHOLE (replace every
 * part, or none), because the parts carry an invariant between them — they must
 * sum to the parent's amount — and a per-row `update` would let a caller break
 * it one row at a time with no single place to check.
 */
export const transactionSplitRepo = {
  /** The parts of one transaction, in the order the user arranged them. */
  byTransaction(transactionId: string): TransactionSplit[] {
    return db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId))
      .orderBy(asc(transactionSplits.sortOrder))
      .all();
  },

  /**
   * The parts of many transactions at once, grouped by transaction id.
   *
   * The entry list on a budget line renders a "split across N lines" note per
   * row, and doing that with one query per row is the N+1 that makes a busy
   * month's list stutter.
   */
  byTransactions(transactionIds: readonly string[]): Map<string, TransactionSplit[]> {
    const grouped = new Map<string, TransactionSplit[]>();
    if (transactionIds.length === 0) return grouped;

    const rows = db
      .select()
      .from(transactionSplits)
      .where(inArray(transactionSplits.transactionId, [...transactionIds]))
      .orderBy(asc(transactionSplits.sortOrder))
      .all();

    for (const row of rows) {
      const existing = grouped.get(row.transactionId);
      if (existing) existing.push(row);
      else grouped.set(row.transactionId, [row]);
    }
    return grouped;
  },

  /**
   * Replace a transaction's parts wholesale.
   *
   * Delete-then-insert inside ONE transaction, so a split is never observable
   * half-written — an interrupted save that left the old parts deleted and the
   * new ones missing would silently drop the payment out of every line's total
   * while leaving the parent transaction in place.
   *
   * Passing an empty list is how a split is UNDONE: the parts go, and the
   * parent reverts to counting whole against its own `subcategoryId`, which is
   * the same state as a transaction that was never split.
   */
  replace(
    transactionId: string,
    parts: readonly { subcategoryId: string; amountMinor: number; note?: string | null }[],
  ): TransactionSplit[] {
    return db.transaction((tx) => {
      tx.delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, transactionId))
        .run();

      if (parts.length === 0) return [];

      return tx
        .insert(transactionSplits)
        .values(
          parts.map((part, index) => ({
            id: createId(),
            transactionId,
            subcategoryId: part.subcategoryId,
            amountMinor: part.amountMinor,
            note: part.note ?? null,
            sortOrder: index,
          })),
        )
        .returning()
        .all();
    });
  },
};

export const stateRepo = {
  /**
   * All subcategory states for a period, keyed by subcategoryId. Statuses are
   * collapsed to pending/paid so no caller sees a legacy value.
   */
  byPeriod(period: string): Map<string, SubcategoryState> {
    const rows = db
      .select()
      .from(subcategoryStates)
      .where(eq(subcategoryStates.period, period))
      .all();
    return new Map(rows.map((row) => [row.subcategoryId, readSubState(row)]));
  },

  /**
   * How many months this subcategory has been marked paid, across every
   * period. Drives saving-plan progress, which is derived from the checklist
   * rather than a stored running total so the two can never disagree.
   *
   * Legacy `transferred`/`completed` rows count as paid, matching `readSubState`.
   */
  paidPeriodCount(subcategoryId: string): number {
    const rows = db
      .select()
      .from(subcategoryStates)
      .where(eq(subcategoryStates.subcategoryId, subcategoryId))
      .all();
    return rows.filter((row) => readSubState(row).status === 'paid').length;
  },

  /**
   * Set a bill's status for a period, creating the row on first touch. Upsert
   * keyed on (subcategoryId, period), which has a unique index.
   */
  setStatus(subcategoryId: string, period: string, status: SubcategoryStatus): void {
    // `completedAt` records when the bill was paid, reused for the 2-state model.
    const timestamps = { completedAt: status === 'paid' ? now() : null };

    db.insert(subcategoryStates)
      .values({ id: createId(), subcategoryId, period, status, ...timestamps })
      .onConflictDoUpdate({
        target: [subcategoryStates.subcategoryId, subcategoryStates.period],
        set: { status, ...timestamps, updatedAt: now() },
      })
      .run();
  },

  /** Record what a subcategory actually cost, when it differed from the plan. */
  setActual(subcategoryId: string, period: string, actualMinor: number | null): void {
    db.insert(subcategoryStates)
      .values({ id: createId(), subcategoryId, period, status: 'pending', actualMinor })
      .onConflictDoUpdate({
        target: [subcategoryStates.subcategoryId, subcategoryStates.period],
        set: { actualMinor, updatedAt: now() },
      })
      .run();
  },

  /**
   * Log a transaction against a subcategory in one write: status plus
   * whichever of actual amount, note, and photo the user filled in. A key
   * left `undefined` is not touched; pass `null` to explicitly clear it.
   */
  logTransaction(
    subcategoryId: string,
    period: string,
    input: {
      status: SubcategoryStatus;
      actualMinor?: number | null;
      note?: string | null;
      imageUri?: string | null;
      /** Which property this month's payment was for — see `houses`. */
      houseId?: string | null;
    },
  ): void {
    const statusTimestamps = { completedAt: input.status === 'paid' ? now() : null };

    const patch: Partial<typeof subcategoryStates.$inferInsert> = {
      status: input.status,
      ...statusTimestamps,
      updatedAt: now(),
    };
    if (input.actualMinor !== undefined) patch.actualMinor = input.actualMinor;
    if (input.note !== undefined) patch.note = input.note;
    if (input.imageUri !== undefined) patch.imageUri = input.imageUri;
    if (input.houseId !== undefined) patch.houseId = input.houseId;

    db.insert(subcategoryStates)
      .values({
        id: createId(),
        subcategoryId,
        period,
        status: input.status,
        ...statusTimestamps,
        actualMinor: input.actualMinor ?? null,
        note: input.note ?? null,
        imageUri: input.imageUri ?? null,
        houseId: input.houseId ?? null,
      })
      .onConflictDoUpdate({
        target: [subcategoryStates.subcategoryId, subcategoryStates.period],
        set: patch,
      })
      .run();
  },

  /** Bulk-set every bill in a category — powers "mark all paid". */
  setStatusForSubcategories(
    subcategoryIds: readonly string[],
    period: string,
    status: SubcategoryStatus,
  ): void {
    for (const subcategoryId of subcategoryIds) {
      stateRepo.setStatus(subcategoryId, period, status);
    }
  },
};

export const categoryStateRepo = {
  /** All category bulk-transfer states for a period, keyed by categoryId. */
  byPeriod(period: string): Map<string, CategoryState> {
    const rows = db
      .select()
      .from(categoryStates)
      .where(eq(categoryStates.period, period))
      .all();
    return new Map(rows.map((row) => [row.categoryId, row]));
  },

  /** Set a category's bulk-transfer status for a period (upsert). */
  setStatus(categoryId: string, period: string, status: CategoryFundingStatus): void {
    const transferredAt = status === 'transferred' ? now() : null;
    db.insert(categoryStates)
      .values({ id: createId(), categoryId, period, status, transferredAt })
      .onConflictDoUpdate({
        target: [categoryStates.categoryId, categoryStates.period],
        set: { status, transferredAt, updatedAt: now() },
      })
      .run();
  },
};

export const fundingRepo = {
  byPeriod(period: string): Funding[] {
    return db.select().from(fundings).where(eq(fundings.period, period)).all();
  },

  /** Total transferred per category for a period, computed in SQL. */
  totalsByPeriod(period: string): Map<string, number> {
    const rows = db
      .select({
        categoryId: fundings.categoryId,
        total: sql<number>`COALESCE(SUM(${fundings.amountMinor}), 0)`,
      })
      .from(fundings)
      .where(eq(fundings.period, period))
      .groupBy(fundings.categoryId)
      .all();
    return new Map(rows.map((row) => [row.categoryId, Number(row.total)]));
  },

  create(input: Omit<NewFunding, 'id'> & { id?: string }): Funding {
    return db
      .insert(fundings)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  remove(id: string): void {
    db.delete(fundings).where(eq(fundings.id, id)).run();
  },

  /** Undo funding for a category in a period — used by "reset this month". */
  clearForCategory(categoryId: string, period: string): void {
    db.delete(fundings)
      .where(and(eq(fundings.categoryId, categoryId), eq(fundings.period, period)))
      .run();
  },
};

export const incomeRepo = {
  all(): Income[] {
    return db
      .select()
      .from(incomes)
      .where(eq(incomes.isActive, true))
      .orderBy(asc(incomes.sortOrder))
      .all();
  },
  create(input: Omit<NewIncome, 'id'> & { id?: string }): Income {
    return db
      .insert(incomes)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },
  update(id: string, patch: Partial<NewIncome>): Income | undefined {
    return db
      .update(incomes)
      .set({ ...patch, updatedAt: now() })
      .where(eq(incomes.id, id))
      .returning()
      .get();
  },
  remove(id: string): void {
    db.delete(incomes).where(eq(incomes.id, id)).run();
  },
};
