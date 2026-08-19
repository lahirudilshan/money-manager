import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  merchantKey,
  type MerchantRule,
  type RuleUpsert,
} from '~/features/sms/logic/merchantRules';
import { SEED_MERCHANT_PATTERNS } from '~/features/sms/logic/smsCategoryHints';
import type { CatalogPlan } from '~/features/sms/logic/catalogSync';
import { db, expoDb } from './client';
import {
  cards,
  categories,
  categoryStates,
  fundings,
  houses,
  incomes,
  loans,
  merchantRules,
  settings,
  smsInbox,
  subcategories,
  subcategoryStates,
  transactions,
  fuelEntries,
  vehicles,
  vehicleServices,
  serviceItems,
  healthPeople,
  healthMedicines,
  healthVisits,
  healthDocuments,
  healthReadings,
  meterReadings,
  type MeterReading,
  type NewMeterReading,
  type Card,
  type Category,
  type CategoryFundingStatus,
  type CategoryState,
  type Funding,
  type House,
  type Income,
  type Loan,
  type NewHouse,
  type MerchantRuleRow,
  type NewCard,
  type NewCategory,
  type NewFunding,
  type NewIncome,
  type NewLoan,
  type NewSmsInboxRow,
  type NewSubcategory,
  type NewTransaction,
  type SmsInboxRow,
  type SmsInboxStatus,
  type Subcategory,
  type SubcategoryState,
  type SubcategoryStatus,
  type Transaction,
  type FuelEntry,
  type NewFuelEntry,
  type NewVehicle,
  type NewVehicleService,
  type Vehicle,
  type VehicleService,
  type ServiceItem,
  type NewServiceItem,
  type HealthPerson,
  type NewHealthPerson,
  type HealthMedicine,
  type NewHealthMedicine,
  type HealthVisit,
  type NewHealthVisit,
  type HealthDocument,
  type NewHealthDocument,
  type HealthReading,
  type NewHealthReading,
} from './schema';

/**
 * Collapse a stored subcategory status to the 2-value model used everywhere
 * above the DB. Old rows can hold `transferred`/`completed` from the previous
 * 3-state design; both mean the bill is settled, so both read as `paid`.
 */
function normaliseSubStatus(stored: string): SubcategoryStatus {
  return stored === 'pending' ? 'pending' : 'paid';
}

/** A subcategory state row with its status collapsed to pending/paid. */
function readSubState(row: SubcategoryState): SubcategoryState {
  return { ...row, status: normaliseSubStatus(row.status) };
}

/** Collision-resistant id without a uuid dependency. */
export function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const now = () => new Date();

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
};

/**
 * Individual entries under an `unplanned` subcategory. Its per-period "actual"
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
   * Total spent per unplanned subcategory for a period, computed in SQL. Used
   * as the subcategory's effective "actual" so the two can never disagree.
   */
  totalsByPeriod(period: string): Map<string, number> {
    const rows = db
      .select({
        subcategoryId: transactions.subcategoryId,
        total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.period, period))
      .groupBy(transactions.subcategoryId)
      .all();
    return new Map(rows.map((row) => [row.subcategoryId, Number(row.total)]));
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

/**
 * The learned merchant → line map (see core/merchantRules.ts for the matching
 * logic, which stays pure; this is only storage).
 *
 * Reads return the plain `MerchantRule` shape the core module expects, so the
 * ranking code never sees a Drizzle row or a nullable timestamp.
 */
export const merchantRuleRepo = {
  all(): MerchantRule[] {
    return db
      .select()
      .from(merchantRules)
      .orderBy(desc(merchantRules.hitCount))
      .all()
      .map(toMerchantRule);
  },

  /**
   * Apply the edit `planRuleUpsert` decided on. Inserting records a brand-new
   * merchant; strengthening bumps `hitCount` and re-points the rule at the line
   * the user actually chose — which is what turns a correction into learning.
   */
  apply(upsert: RuleUpsert): void {
    if (upsert.kind === 'insert') {
      db.insert(merchantRules)
        .values({
          id: createId(),
          pattern: upsert.pattern,
          subcategoryId: upsert.subcategoryId,
          hint: upsert.hint,
          source: 'learned',
          hitCount: 1,
        })
        .run();
      return;
    }

    db.update(merchantRules)
      .set({
        subcategoryId: upsert.subcategoryId,
        // A corrected rule is now user-authored, whatever it started as.
        source: 'learned',
        hitCount: sql`${merchantRules.hitCount} + 1`,
        updatedAt: now(),
      })
      .where(eq(merchantRules.id, upsert.id))
      .run();
  },

  /**
   * Populate the shipped merchant patterns once, so a brand-new install already
   * recognises the common Sri Lankan chains instead of asking about every one.
   * Idempotent: patterns that already exist are skipped, so this is safe to run
   * on every launch and never overwrites what the user has taught.
   */
  seed(): void {
    const existing = new Set(
      db.select({ pattern: merchantRules.pattern }).from(merchantRules).all().map((r) => r.pattern),
    );

    const rows = SEED_MERCHANT_PATTERNS.flatMap(([hint, patterns]) =>
      patterns
        .map((pattern) => merchantKey(pattern))
        .filter((pattern) => pattern && !existing.has(pattern))
        .map((pattern) => ({
          id: createId(),
          pattern,
          // Seeds carry the hint only — they cannot know the user's lines.
          subcategoryId: null,
          hint,
          source: 'seed' as const,
          hitCount: 0,
        })),
    );

    if (rows.length > 0) db.insert(merchantRules).values(rows).run();
  },

  /**
   * Apply a merge plan from the shared catalog (see core/catalogSync.ts).
   *
   * Inserted rows carry `subcategoryId: null` and stay `source: 'seed'`: the
   * catalog knows what a merchant IS, never which of this user's lines it
   * belongs to. Keeping them 'seed' is what makes them eligible for a later
   * catalog correction — and what stops them being uploaded back as votes,
   * which would let the catalog endlessly re-confirm its own output.
   *
   * Returns the counts the Settings screen reports.
   */
  applyCatalog(plan: CatalogPlan): { inserted: number; updated: number } {
    for (const row of plan.insert) {
      db.insert(merchantRules)
        .values({
          id: createId(),
          pattern: row.pattern,
          subcategoryId: null,
          hint: row.hint,
          source: 'seed',
          hitCount: 0,
        })
        .run();
    }

    for (const row of plan.updateHint) {
      db.update(merchantRules)
        .set({ hint: row.hint, updatedAt: now() })
        .where(eq(merchantRules.id, row.id))
        .run();
    }

    return { inserted: plan.insert.length, updated: plan.updateHint.length };
  },

  remove(id: string): void {
    db.delete(merchantRules).where(eq(merchantRules.id, id)).run();
  },
};

/** Drizzle row → the plain shape core/merchantRules.ts ranks over. */
function toMerchantRule(row: MerchantRuleRow): MerchantRule {
  return {
    id: row.id,
    pattern: row.pattern,
    subcategoryId: row.subcategoryId,
    hint: (row.hint as MerchantRule['hint']) ?? null,
    source: row.source,
    hitCount: row.hitCount,
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * The durable SMS review queue.
 *
 * Every write here is idempotent on `fingerprint`, which is what lets the drain
 * be retried safely: the file is cleared only AFTER these rows land, so a crash
 * in between replays the same messages and the unique index absorbs them.
 */
export const smsInboxRepo = {
  /**
   * Queue a message, or do nothing if it is already known.
   *
   * Returns whether a new row was created, which is what the drain reports back
   * to the user as "3 to review" versus "already added". `onConflictDoNothing`
   * covers both a retried drain and a Shortcut that appended the same alert
   * twice, without a read-then-write race.
   */
  add(input: Omit<NewSmsInboxRow, 'id'>): boolean {
    const changes = db
      .insert(smsInbox)
      .values({ ...input, id: createId() })
      .onConflictDoNothing({ target: smsInbox.fingerprint })
      .run().changes;

    return changes > 0;
  },

  /**
   * Whether a fingerprint is already queued and still awaiting the user.
   *
   * Distinguishes the two cases `add` returning false collapses together: a row
   * that is still `pending` (genuinely a repeat delivery of something already on
   * screen) from one the user already confirmed or dismissed. Only the first is
   * a real duplicate; treating both alike is what made a re-sent test message
   * vanish with no trace.
   */
  isPending(fingerprint: string): boolean {
    const row = db
      .select({ id: smsInbox.id })
      .from(smsInbox)
      .where(and(eq(smsInbox.fingerprint, fingerprint), eq(smsInbox.status, 'pending')))
      .get();

    return row !== undefined;
  },

  /**
   * Put a resolved row back in the queue, keeping its id and fingerprint.
   *
   * The queue is fingerprint-unique so the same message can never occupy two
   * rows — which means a message the user acted on months ago is permanently
   * unimportable, even when the bank genuinely sends that exact text again.
   * Reopening is the escape hatch: the row returns to `pending` with its
   * resolution cleared, so it appears for review instead of being swallowed.
   *
   * Used only when a message arrives whose fingerprint maps to an ALREADY
   * RESOLVED row. A still-pending row is left alone — it is on screen already.
   */
  /**
   * Rewrite a row's PARSED columns from a fresh parse of its `raw` text.
   *
   * The columns are a snapshot from whichever parser drained the message, and
   * nothing else updates them — so a row queued before a parser improvement
   * keeps its old verdict forever. Only the parse is touched: `status`,
   * `fingerprint` and the timestamps are untouched, so this can never resurrect
   * a resolved row or duplicate one.
   */
  updateParse(
    id: string,
    parse: Partial<Pick<NewSmsInboxRow,
      'direction' | 'kind' | 'amountMinor' | 'currency' | 'merchant' | 'account' | 'occurredOn' | 'occurredAt'
    >>,
  ): void {
    db.update(smsInbox)
      .set({ ...parse, updatedAt: now() })
      .where(eq(smsInbox.id, id))
      .run();
  },

  reopen(fingerprint: string): boolean {
    const changes = db
      .update(smsInbox)
      .set({ status: 'pending', resolvedAt: null, receivedAt: new Date(), updatedAt: now() })
      .where(eq(smsInbox.fingerprint, fingerprint))
      .run().changes;

    return changes > 0;
  },

  /**
   * Messages still awaiting the user, NEWEST TRANSACTION FIRST.
   *
   * Ordered by when the money actually moved (`occurred_on` + `occurred_at`),
   * not by when the app happened to import the row. Those differ constantly: a
   * batch drained in one go shares a single `received_at`, so ordering by it
   * left messages from the same import in arbitrary order — a 15:21 purchase
   * could sit above a 15:20 one. Worse, a backlog imported after a week offline
   * would order by import time and interleave old and new transactions at
   * random.
   *
   * Rows with no parsed date sort last rather than first: an unknown date is
   * not evidence of being recent, and putting them at the top would push the
   * messages the user actually recognises off the screen.
   *
   * COALESCE supplies a low sentinel for the missing case, and the time falls
   * back to midnight so a dateless-but-timed row still sorts sensibly within its
   * day. `received_at` breaks any remaining tie so the order is stable across
   * reloads rather than shifting under the user.
   */
  pending(): SmsInboxRow[] {
    return db
      .select()
      .from(smsInbox)
      .where(eq(smsInbox.status, 'pending'))
      .orderBy(
        sql`COALESCE(${smsInbox.occurredOn}, '0000-00-00') DESC`,
        sql`COALESCE(${smsInbox.occurredAt}, '00:00') DESC`,
        desc(smsInbox.receivedAt),
      )
      .all();
  },

  /** How many are waiting, for the badge — cheaper than loading the rows. */
  pendingCount(): number {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(smsInbox)
      .where(eq(smsInbox.status, 'pending'))
      .get();

    return row?.count ?? 0;
  },

  /**
   * Mark a row acted-on. The row is KEPT, not deleted: its fingerprint is what
   * stops the same message being re-queued if it arrives again.
   */
  resolve(id: string, status: Extract<SmsInboxStatus, 'confirmed' | 'dismissed'>): void {
    db.update(smsInbox)
      .set({ status, resolvedAt: now(), updatedAt: now() })
      .where(eq(smsInbox.id, id))
      .run();
  },
};

/**
 * The durable record of every message the intake has seen.
 *
 * Separate from `smsInboxRepo`, which is the pending REVIEW QUEUE and empties
 * as the user acts. This never empties (beyond pruning), because its whole
 * purpose is answering "what happened to the message from Tuesday?" long after
 * the queue has moved on.
 *
 * Raw SQL rather than Drizzle: the table is diagnostics, deliberately absent
 * from schema.ts and from backups, so it has no generated model.
 */
export const smsLogRepo = {
  /** Record an outcome. Same fingerprint twice updates rather than duplicates. */
  record(entry: {
    raw: string;
    fingerprint: string;
    outcome: string;
    reason?: string | null;
    source?: string;
    amountMinor?: number | null;
    merchant?: string | null;
    kind?: string | null;
    occurredOn?: string | null;
  }): void {
    try {
      /*
       * Keyed by fingerprint, so a message re-delivered by the automation
       * updates its row instead of filling the log with copies. The LATEST
       * outcome wins — a message that failed and later succeeded should read as
       * succeeded.
       */
      expoDb.runSync(
        `INSERT INTO sms_log (id, raw, fingerprint, outcome, reason, source, amount_minor, merchant, kind, occurred_on, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           outcome = excluded.outcome,
           reason = excluded.reason,
           amount_minor = excluded.amount_minor,
           merchant = excluded.merchant,
           kind = excluded.kind,
           seen_at = excluded.seen_at`,
        [
          createId(),
          entry.raw,
          entry.fingerprint,
          entry.outcome,
          entry.reason ?? null,
          entry.source ?? 'file',
          entry.amountMinor ?? null,
          entry.merchant ?? null,
          entry.kind ?? null,
          entry.occurredOn ?? null,
          Date.now(),
        ],
      );
    } catch {
      // Diagnostics must never break intake. A log write that fails is a lost
      // log line; a throw here would lose the transaction itself.
    }
  },

  /** Newest first. `outcome` filters to one bucket for the segmented view. */
  recent(limit = 200, outcome?: string): SmsLogRow[] {
    try {
      return expoDb.getAllSync(
        outcome
          ? `SELECT * FROM sms_log WHERE outcome = ? ORDER BY seen_at DESC LIMIT ?`
          : `SELECT * FROM sms_log ORDER BY seen_at DESC LIMIT ?`,
        outcome ? [outcome, limit] : [limit],
      ) as SmsLogRow[];
    } catch {
      return [];
    }
  },

  /** How many of each outcome, for the summary chips. */
  counts(): Record<string, number> {
    try {
      const rows = expoDb.getAllSync(
        `SELECT outcome, count(*) AS n FROM sms_log GROUP BY outcome`,
      ) as { outcome: string; n: number }[];

      return Object.fromEntries(rows.map((row) => [row.outcome, row.n]));
    } catch {
      return {};
    }
  },

  clear(): void {
    try {
      expoDb.execSync('DELETE FROM sms_log;');
    } catch {
      // Nothing to clear.
    }
  },
};

export interface SmsLogRow {
  id: string;
  raw: string;
  fingerprint: string;
  outcome: string;
  reason: string | null;
  source: string;
  amount_minor: number | null;
  merchant: string | null;
  kind: string | null;
  occurred_on: string | null;
  seen_at: number;
}

/** Vehicles for the fuel mini-app. Empty on a device that never enables it. */
export const vehicleRepo = {
  all(): Vehicle[] {
    return db
      .select()
      .from(vehicles)
      .orderBy(asc(vehicles.sortOrder), asc(vehicles.createdAt))
      .all();
  },

  create(input: Omit<NewVehicle, 'id'> & { id?: string }): Vehicle {
    return db
      .insert(vehicles)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewVehicle>): void {
    db.update(vehicles)
      .set({ ...patch, updatedAt: now() })
      .where(eq(vehicles.id, id))
      .run();
  },

  /** Cascades to the vehicle's fill-ups and services — see the schema. */
  remove(id: string): void {
    db.delete(vehicles).where(eq(vehicles.id, id)).run();
  },
};

export const fuelEntryRepo = {
  /**
   * A vehicle's fill-ups, ordered by ODOMETER.
   *
   * That is the order consumption is measured in: a receipt entered late has a
   * truthful reading and a misleading timestamp. See core/fuel.ts.
   */
  byVehicle(vehicleId: string): FuelEntry[] {
    return db
      .select()
      .from(fuelEntries)
      .where(eq(fuelEntries.vehicleId, vehicleId))
      .orderBy(asc(fuelEntries.odometer), asc(fuelEntries.filledAt))
      .all();
  },

  create(input: Omit<NewFuelEntry, 'id'> & { id?: string }): FuelEntry {
    return db
      .insert(fuelEntries)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewFuelEntry>): void {
    db.update(fuelEntries)
      .set({ ...patch, updatedAt: now() })
      .where(eq(fuelEntries.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(fuelEntries).where(eq(fuelEntries.id, id)).run();
  },
};

export const vehicleServiceRepo = {
  /** Newest first — a service log is read as history, not as a route. */
  byVehicle(vehicleId: string): VehicleService[] {
    return db
      .select()
      .from(vehicleServices)
      .where(eq(vehicleServices.vehicleId, vehicleId))
      .orderBy(desc(vehicleServices.servicedAt))
      .all();
  },

  create(input: Omit<NewVehicleService, 'id'> & { id?: string }): VehicleService {
    return db
      .insert(vehicleServices)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewVehicleService>): void {
    db.update(vehicleServices)
      .set({ ...patch, updatedAt: now() })
      .where(eq(vehicleServices.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(vehicleServices).where(eq(vehicleServices.id, id)).run();
  },
};

/**
 * The parts, fluids and labour on one service bill.
 *
 * Kept apart from `vehicleServices.costMinor`, which stays the authoritative
 * total: a real invoice carries tax and discounts the lines do not sum to, so
 * the two are allowed to differ and the UI says so rather than silently
 * overwriting what the user typed.
 */
export const serviceItemRepo = {
  byService(serviceId: string): ServiceItem[] {
    return db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.serviceId, serviceId))
      .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.createdAt))
      .all();
  },

  /** Every item for a set of services, grouped — one query for a whole list. */
  byServices(serviceIds: readonly string[]): Map<string, ServiceItem[]> {
    if (serviceIds.length === 0) return new Map();

    const rows = db
      .select()
      .from(serviceItems)
      .where(inArray(serviceItems.serviceId, [...serviceIds]))
      .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.createdAt))
      .all();

    const grouped = new Map<string, ServiceItem[]>();
    for (const row of rows) {
      const list = grouped.get(row.serviceId) ?? [];
      list.push(row);
      grouped.set(row.serviceId, list);
    }
    return grouped;
  },

  create(input: Omit<NewServiceItem, 'id'> & { id?: string }): ServiceItem {
    return db
      .insert(serviceItems)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  remove(id: string): void {
    db.delete(serviceItems).where(eq(serviceItems.id, id)).run();
  },
};

/*
 * ---------------------------------------------------------------------------
 * Health mini-app — see core/miniApps.ts. Opt-in; these tables stay empty on a
 * device that never enables it.
 * ---------------------------------------------------------------------------
 */

/**
 * Release whoever currently holds "self", relation included.
 *
 * Clearing only the flag would leave the previous holder still labelled
 * "Myself" in the list — two people answering the same question. Their relation
 * is nulled rather than guessed at: the app cannot know whether the person who
 * used to be you is now a spouse or a sibling, and an unset relation simply
 * shows no subtitle (see `relationLabel`).
 *
 * Takes the transaction so every caller runs inside one — claiming self and
 * releasing it are halves of the same write.
 */
function clearSelf(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): void {
  tx.update(healthPeople)
    .set({ isSelf: false, relation: null, updatedAt: now() })
    .where(eq(healthPeople.isSelf, true))
    .run();
}

export const healthPersonRepo = {
  all(): HealthPerson[] {
    return db
      .select()
      .from(healthPeople)
      .orderBy(
        // The phone's owner first — it is who the timeline opens on.
        desc(healthPeople.isSelf),
        asc(healthPeople.sortOrder),
        asc(healthPeople.createdAt),
      )
      .all();
  },

  byId(id: string): HealthPerson | undefined {
    return db.select().from(healthPeople).where(eq(healthPeople.id, id)).get();
  },

  /**
   * Add a person, keeping `isSelf` in step with a `self` relation.
   *
   * The two are one fact stored twice — the flag is what the timeline sorts and
   * defaults by, the relation is what the user actually picked — so deriving
   * one from the other here is what stops them disagreeing. Written as a
   * transaction because claiming `self` also has to release the previous holder.
   */
  create(input: Omit<NewHealthPerson, 'id'> & { id?: string }): HealthPerson {
    const isSelf = input.relation === 'self' || input.isSelf === true;

    return db.transaction((tx) => {
      if (isSelf) clearSelf(tx);

      return tx
        .insert(healthPeople)
        .values({ ...input, id: input.id ?? createId(), isSelf })
        .returning()
        .get();
    });
  },

  update(id: string, patch: Partial<NewHealthPerson>): void {
    db.transaction((tx) => {
      /*
       * Only touch `isSelf` when the relation is actually being changed.
       *
       * A patch that just edits a blood group must not silently demote the
       * person from "self" — `patch.relation` is undefined there, which is
       * different from it being set to something that is not `self`.
       */
      const next =
        patch.relation === undefined
          ? patch
          : { ...patch, isSelf: patch.relation === 'self' };

      if (patch.relation === 'self') clearSelf(tx);

      tx.update(healthPeople)
        .set({ ...next, updatedAt: now() })
        .where(eq(healthPeople.id, id))
        .run();
    });
  },

  /**
   * Make one person the "self", clearing any previous holder.
   *
   * Enforced here rather than by a constraint, the same way `houseRepo.setPrimary`
   * does it: SQLite cannot express "exactly one row has this flag", and two
   * selves would make the timeline's default person ambiguous.
   *
   * Moves the RELATION too, so the person who was "Myself" does not keep that
   * label after somebody else claimed it.
   */
  setSelf(id: string): void {
    db.transaction((tx) => {
      clearSelf(tx);
      tx.update(healthPeople)
        .set({ isSelf: true, relation: 'self', updatedAt: now() })
        .where(eq(healthPeople.id, id))
        .run();
    });
  },

  /** Cascades to every medicine, dose, visit, document and reading. */
  remove(id: string): void {
    db.delete(healthPeople).where(eq(healthPeople.id, id)).run();
  },
};

export const healthMedicineRepo = {
  /** Active courses first, then finished ones — both newest first. */
  byPerson(personId: string): HealthMedicine[] {
    return db
      .select()
      .from(healthMedicines)
      .where(eq(healthMedicines.personId, personId))
      .orderBy(desc(healthMedicines.isActive), desc(healthMedicines.startedOn))
      .all();
  },

  byId(id: string): HealthMedicine | undefined {
    return db.select().from(healthMedicines).where(eq(healthMedicines.id, id)).get();
  },

  /**
   * What one visit prescribed.
   *
   * The visit detail page reads this to show a consultation and its
   * prescriptions as a single episode, which is how it happened in the room.
   */
  byVisit(visitId: string): HealthMedicine[] {
    return db
      .select()
      .from(healthMedicines)
      .where(eq(healthMedicines.visitId, visitId))
      .orderBy(desc(healthMedicines.startedOn))
      .all();
  },

  /** Every active medicine across everyone — for the refill warnings. */
  allActive(): HealthMedicine[] {
    return db
      .select()
      .from(healthMedicines)
      .where(eq(healthMedicines.isActive, true))
      .all();
  },

  create(input: Omit<NewHealthMedicine, 'id'> & { id?: string }): HealthMedicine {
    return db
      .insert(healthMedicines)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthMedicine>): void {
    db.update(healthMedicines)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthMedicines.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthMedicines).where(eq(healthMedicines.id, id)).run();
  },
};

export const healthVisitRepo = {
  byPerson(personId: string): HealthVisit[] {
    return db
      .select()
      .from(healthVisits)
      .where(eq(healthVisits.personId, personId))
      .orderBy(desc(healthVisits.visitedAt))
      .all();
  },

  byId(id: string): HealthVisit | undefined {
    return db.select().from(healthVisits).where(eq(healthVisits.id, id)).get();
  },

  /** Every visit carrying a follow-up date — feeds `upcoming()`. */
  withFollowUps(): HealthVisit[] {
    return db
      .select()
      .from(healthVisits)
      .where(sql`${healthVisits.followUpOn} IS NOT NULL`)
      .orderBy(asc(healthVisits.followUpOn))
      .all();
  },

  create(input: Omit<NewHealthVisit, 'id'> & { id?: string }): HealthVisit {
    return db
      .insert(healthVisits)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthVisit>): void {
    db.update(healthVisits)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthVisits.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthVisits).where(eq(healthVisits.id, id)).run();
  },
};

export const healthDocumentRepo = {
  byPerson(personId: string): HealthDocument[] {
    return db
      .select()
      .from(healthDocuments)
      .where(eq(healthDocuments.personId, personId))
      .orderBy(desc(healthDocuments.documentDate))
      .all();
  },

  byVisit(visitId: string): HealthDocument[] {
    return db
      .select()
      .from(healthDocuments)
      .where(eq(healthDocuments.visitId, visitId))
      .orderBy(desc(healthDocuments.documentDate))
      .all();
  },

  create(input: Omit<NewHealthDocument, 'id'> & { id?: string }): HealthDocument {
    return db
      .insert(healthDocuments)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthDocument>): void {
    db.update(healthDocuments)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthDocuments.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthDocuments).where(eq(healthDocuments.id, id)).run();
  },
};

export const healthReadingRepo = {
  byPerson(personId: string): HealthReading[] {
    return db
      .select()
      .from(healthReadings)
      .where(eq(healthReadings.personId, personId))
      .orderBy(desc(healthReadings.measuredAt))
      .all();
  },

  /** Readings taken at one visit — the figures measured in the room. */
  byVisit(visitId: string): HealthReading[] {
    return db
      .select()
      .from(healthReadings)
      .where(eq(healthReadings.visitId, visitId))
      .orderBy(desc(healthReadings.measuredAt))
      .all();
  },

  /** One metric's history, oldest first — the order a chart plots in. */
  byMetric(personId: string, metric: HealthReading['metric']): HealthReading[] {
    return db
      .select()
      .from(healthReadings)
      .where(and(eq(healthReadings.personId, personId), eq(healthReadings.metric, metric)))
      .orderBy(asc(healthReadings.measuredAt))
      .all();
  },

  create(input: Omit<NewHealthReading, 'id'> & { id?: string }): HealthReading {
    return db
      .insert(healthReadings)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthReading>): void {
    db.update(healthReadings)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthReadings.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthReadings).where(eq(healthReadings.id, id)).run();
  },
};

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

export const settingsRepo = {
  get(key: string): string | undefined {
    return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
  },
  set(key: string, value: string): void {
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
      .run();
  },
  getNumber(key: string, fallback: number): number {
    const raw = settingsRepo.get(key);
    if (raw === undefined) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
};

export const SETTINGS_KEYS = {
  currency: 'currency',
  usdRate: 'usd_rate',
  onboarded: 'onboarded',
  /**
   * An in-progress onboarding plan, so closing the app mid-setup does not lose
   * everything typed so far. Holds the DRAFT only — see core/onboardingDraft.ts
   * — never the board itself, which is still written on confirm.
   */
  onboardingDraft: 'onboarding_draft',
  themeMode: 'theme_mode',
  haptics: 'haptics',
  /** Require Face ID / Touch ID / passcode before the app's contents are shown. */
  appLock: 'app_lock',
  /** Subscription tier — see core/plans.ts. */
  plan: 'plan',
  /** Share anonymous merchant corrections with the shared catalog. */
  catalogSync: 'catalog_sync',
  /**
   * Whether the Shortcuts drop-file intake is set up.
   *
   * Stored rather than inferred from the file existing: the app DELETES that
   * file every time it drains it, so "does it exist" is false most of the time
   * on a working setup — which made the toggle appear to switch itself off.
   */
  smsInboxEnabled: 'sms_inbox_enabled',
  /** Cursor for incremental catalog pulls — the last row's `updated_at`|`id`. */
  catalogCursor: 'catalog_cursor',
  /** When the catalog last synced, for the Settings status line. */
  catalogSyncedAt: 'catalog_synced_at',
  /** Comma-separated ids of enabled mini apps — see core/miniApps.ts. */
  miniApps: 'mini_apps',
  /**
   * ISO timestamp of the last successful Drive upload.
   *
   * Stored rather than read back from Drive so the "last backed up" line
   * renders instantly and offline — asking Drive would make the screen depend
   * on a network round trip to say something it already knows.
   */
  lastCloudBackupAt: 'last_cloud_backup_at',
  /** ISO timestamp of the last local backup file written. */
  lastLocalBackupAt: 'last_local_backup_at',

  /** Whether the app refreshes the USD rate on its own — see core/exchangeRate.ts. */
  rateAutoFetch: 'rate_auto_fetch',
  /** Which figure the board converts with: 'live' | 'average' | 'safe'. */
  rateMode: 'rate_mode',
  /** JSON list of recent readings, newest first. */
  rateHistory: 'rate_history',
  /** ISO timestamp of the last successful fetch, for the daily cadence. */
  rateFetchedAt: 'rate_fetched_at',
} as const;
