import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  merchantKey,
  type MerchantRule,
  type RuleUpsert,
} from '../core/merchantRules';
import { SEED_MERCHANT_PATTERNS } from '../core/smsCategoryHints';
import { db } from './client';
import {
  cards,
  categories,
  categoryStates,
  fundings,
  incomes,
  loans,
  merchantRules,
  settings,
  subcategories,
  subcategoryStates,
  transactions,
  type Card,
  type Category,
  type CategoryFundingStatus,
  type CategoryState,
  type Funding,
  type Income,
  type Loan,
  type MerchantRuleRow,
  type NewCard,
  type NewCategory,
  type NewFunding,
  type NewIncome,
  type NewLoan,
  type NewSubcategory,
  type NewTransaction,
  type Subcategory,
  type SubcategoryState,
  type SubcategoryStatus,
  type Transaction,
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
  themeMode: 'theme_mode',
  haptics: 'haptics',
  /** Require Face ID / Touch ID / passcode before the app's contents are shown. */
  appLock: 'app_lock',
  /** Subscription tier — see core/plans.ts. */
  plan: 'plan',
} as const;
