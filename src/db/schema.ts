import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Money is stored as INTEGER minor units (cents) — never floats, which lose
 * precision on repeated addition. Convert at the UI boundary only.
 *
 * The domain is a *funding board*, not a ledger:
 *   a category is assigned a card -> its total is transferred to that card
 *   -> each subcategory (its individual budget lines) is then marked off.
 * Status therefore lives on the subcategory (the real budget line), a
 * category's total/status is always derived by summing its subcategories,
 * and funding is recorded per category per month.
 */

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

/** A bank account, wallet or savings pot that groups draw from. */
export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['bank', 'wallet', 'savings', 'goal'] })
    .notNull()
    .default('bank'),
  /** Real bank/institution name, e.g. "HNB" — shown on the card face. */
  bankName: text('bank_name'),
  /** Last 4 digits of the account/card number, for a masked "•••• 1234" look. */
  last4: text('last4'),
  color: text('color').notNull().default('#6366F1'),
  icon: text('icon').notNull().default('card-outline'),
  /** Optional target for savings/goal cards. */
  targetMinor: integer('target_minor'),
  /** Balance present before the app started tracking. */
  openingBalanceMinor: integer('opening_balance_minor').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/**
 * The primary object in the app — "Home Expenses", "Loans", "Vehicle Plan".
 * A category is funded as a unit: it owns a default funding card and a due
 * day, and its total/status is always derived by summing its subcategories.
 */
export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** The card this category's money is transferred to by default. */
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    color: text('color').notNull().default('#6366F1'),
    icon: text('icon').notNull().default('albums-outline'),
    /** Day of month the category is normally funded — drives "due" ordering. */
    dueDay: integer('due_day').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [index('categories_card_idx').on(t.cardId)],
);

/**
 * A single planned line inside a category — the real budget line. This is
 * the board's leaf: it carries the planned amount, its funding cadence, an
 * optional due-day and card override, and (per month) its status lives in
 * `subcategoryStates` so changing months never rewrites the subcategory
 * itself.
 */
export const subcategories = sqliteTable(
  'subcategories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type', { enum: ['income', 'expense'] })
      .notNull()
      .default('expense'),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    color: text('color').notNull().default('#6366F1'),
    icon: text('icon').notNull().default('pricetag-outline'),
    plannedMinor: integer('planned_minor').notNull().default(0),
    /** How often this line recurs. */
    frequency: text('frequency', { enum: ['monthly', 'one_time', 'yearly'] })
      .notNull()
      .default('monthly'),
    /** Overrides the parent category's `dueDay` when set. */
    dueDay: integer('due_day'),
    /** Overrides the parent category's funding card when set. */
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    /** Set when this line is a loan installment, to link back to the loan. */
    loanId: text('loan_id').references(() => loans.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [index('subcategories_category_idx').on(t.categoryId)],
);

/**
 * Per-month status of one subcategory — the heart of the app.
 *
 * pending      money not yet moved
 * transferred  money is on the card, bill not yet paid
 * completed    paid and done
 *
 * Keyed by (subcategoryId, period) where period is "YYYY-MM", so each month
 * has an independent checklist and history is preserved.
 */
export const subcategoryStates = sqliteTable(
  'subcategory_states',
  {
    id: text('id').primaryKey(),
    subcategoryId: text('subcategory_id')
      .notNull()
      .references(() => subcategories.id, { onDelete: 'cascade' }),
    /** "YYYY-MM". */
    period: text('period').notNull(),
    status: text('status', { enum: ['pending', 'transferred', 'completed'] })
      .notNull()
      .default('pending'),
    /** Actual amount if it differed from the plan; null means "as planned". */
    actualMinor: integer('actual_minor'),
    transferredAt: integer('transferred_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    note: text('note'),
    /** Local file URI of a receipt/photo attached when logging this transaction. */
    imageUri: text('image_uri'),
    ...timestamps,
  },
  (t) => [
    index('subcategory_states_period_idx').on(t.period),
    index('subcategory_states_lookup_idx').on(t.subcategoryId, t.period),
  ],
);

/**
 * A record of money moved onto a category's card for a given month. A
 * category can be funded in several instalments, so this is a list rather
 * than a flag; the sum is compared against the category's planned total.
 */
export const fundings = sqliteTable(
  'fundings',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    /** "YYYY-MM". */
    period: text('period').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    date: integer('date', { mode: 'timestamp_ms' }).notNull(),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('fundings_lookup_idx').on(t.categoryId, t.period)],
);

/** Income expected each month, used for the ratio dashboard. */
export const incomes = sqliteTable('incomes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
  /** For foreign-currency income: amount in that currency and its rate. */
  foreignAmount: real('foreign_amount'),
  foreignRate: real('foreign_rate'),
  icon: text('icon').notNull().default('cash-outline'),
  color: text('color').notNull().default('#0F8A4D'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/**
 * Loans mirror the spreadsheet's loan blocks. Installment and total interest
 * are always computed (src/core/amortization.ts), never stored, so changing a
 * rate or term cannot leave a stale figure behind.
 */
export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'lease', 'mortgage', 'other'] })
    .notNull()
    .default('personal'),
  principalMinor: integer('principal_minor').notNull(),
  /** Annual nominal rate as a percentage, e.g. 11.5 for 11.50%. */
  annualRatePct: real('annual_rate_pct').notNull(),
  termMonths: integer('term_months').notNull(),
  startDate: integer('start_date', { mode: 'timestamp_ms' }).notNull(),
  color: text('color').notNull().default('#F97316'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
});

/** Key/value app settings (currency, USD rate, onboarding marker). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Subcategory = typeof subcategories.$inferSelect;
export type NewSubcategory = typeof subcategories.$inferInsert;
export type SubcategoryState = typeof subcategoryStates.$inferSelect;
export type NewSubcategoryState = typeof subcategoryStates.$inferInsert;
export type Funding = typeof fundings.$inferSelect;
export type NewFunding = typeof fundings.$inferInsert;
export type Income = typeof incomes.$inferSelect;
export type NewIncome = typeof incomes.$inferInsert;
export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;

/** How often a subcategory recurs. */
export type SubcategoryFrequency = Subcategory['frequency'];
export const SUBCATEGORY_FREQUENCIES: SubcategoryFrequency[] = [
  'monthly',
  'one_time',
  'yearly',
];

/** The three states a planned subcategory moves through in a month. */
export type CategoryStatus = SubcategoryState['status'];
export const CATEGORY_STATUSES: CategoryStatus[] = [
  'pending',
  'transferred',
  'completed',
];
