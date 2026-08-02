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
  /**
   * Id from the bank catalog (src/data/banks.ts) when the account was picked
   * from the list — drives the card's brand colour and monogram. Null for
   * hand-typed accounts, which fall back to name matching.
   */
  bankId: text('bank_id'),
  /** Real bank/institution name, e.g. "HNB" — shown on the card face. */
  bankName: text('bank_name'),
  /**
   * The user's own name for this account — "Salary", "Joint", "Rent money".
   *
   * Distinct from `name` (which is often just the bank, picked from the catalog)
   * and from `bankName`. Someone with three HNB accounts cannot tell them apart
   * from the bank and last-4 alone, so this is what the lists lead with when it
   * is set. Null when the user has not given one, in which case the bank/name
   * pairing is used exactly as before.
   */
  nickname: text('nickname'),
  /** Last 4 digits of the account/card number, for a masked "•••• 1234" look. */
  last4: text('last4'),
  color: text('color').notNull().default('#6366F1'),
  icon: text('icon').notNull().default('card-outline'),
  /**
   * Whether this entry is a payment *card* (shows number/CVV/expiry) versus a
   * plain *account* (shows account number/branch/code). Both live in this one
   * table; this flag switches which detail fields the UI collects and shows.
   */
  isCard: integer('is_card', { mode: 'boolean' }).notNull().default(false),
  /** Card-only details. Sensitive — stored locally only, shown in the detail modal. */
  cardNumber: text('card_number'),
  cvv: text('cvv'),
  expiry: text('expiry'),
  /** Account-only details. */
  accountNumber: text('account_number'),
  branch: text('branch'),
  bankCode: text('bank_code'),
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
    /**
     * Default cadence applied to new bills added under this category. Each
     * bill keeps its own `frequency` and can differ; this only seeds the
     * picker so a "yearly" category doesn't default every bill to monthly.
     */
    defaultFrequency: text('default_frequency', {
      enum: ['monthly', 'one_time', 'yearly'],
    })
      .notNull()
      .default('monthly'),
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
    /**
     * How often this line recurs.
     *
     * `unplanned` is special: the line has no single planned amount paid once a
     * period. Instead it holds many individual transactions (see the
     * `transactions` table), its "actual" is the SUM of those, and it is never
     * marked paid as a whole — the money is tracked entry by entry.
     */
    frequency: text('frequency', { enum: ['monthly', 'one_time', 'yearly', 'unplanned'] })
      .notNull()
      .default('monthly'),
    /** Overrides the parent category's `dueDay` when set. */
    dueDay: integer('due_day'),
    /** Overrides the parent category's funding card when set. */
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    /**
     * "YYYY-MM" a `one_time` line belongs to — the month the cost was actually
     * incurred, which is not necessarily the month the line was created (a cost
     * paid in May can be recorded in July). It counts in that month and in no
     * other. Null on recurring lines, and on one-time lines that predate this
     * field, where the creation month is used as a fallback.
     */
    onceInPeriod: text('once_in_period'),
    /** Set when this line is a loan installment, to link back to the loan. */
    loanId: text('loan_id').references(() => loans.id, { onDelete: 'set null' }),

    /**
     * Saving plan ("sinking fund") for a large bill paid at a future date —
     * vehicle insurance, a 6-month subscription, a credit-card installment
     * plan. When `planTargetMinor` is set, `plannedMinor` is the *monthly*
     * set-aside and these describe the whole commitment:
     *
     *   planTargetMinor  the full amount to reach (e.g. 144,000)
     *   planDueDate      when it must be paid / when cover expires
     *   planStartDate    when saving began, so progress can be derived
     *
     * Null on ordinary bills, which are simply paid each period.
     */
    planTargetMinor: integer('plan_target_minor'),
    planDueDate: integer('plan_due_date', { mode: 'timestamp_ms' }),
    planStartDate: integer('plan_start_date', { mode: 'timestamp_ms' }),
    /** Days before `planDueDate` to warn — drives the expiry reminder. */
    planRemindDaysBefore: integer('plan_remind_days_before').notNull().default(14),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [index('subcategories_category_idx').on(t.categoryId)],
);

/**
 * Individual money movements under an `unplanned` subcategory.
 *
 * A normal (monthly/yearly/one_time) subcategory has a single planned amount
 * paid once a period. An *unplanned* one (e.g. "Groceries", "Eating out") has
 * no fixed amount — it accumulates many small entries. Each row here is one
 * such entry; the subcategory's effective spend for a period is the SUM of its
 * transactions in that period. This is also where a confirmed SMS draft can be
 * logged when it maps to an unplanned line.
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    subcategoryId: text('subcategory_id')
      .notNull()
      .references(() => subcategories.id, { onDelete: 'cascade' }),
    /** "YYYY-MM" the entry counts toward, derived from `date` on write. */
    period: text('period').notNull(),
    /** What it was — merchant/description. */
    name: text('name').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    date: integer('date', { mode: 'timestamp_ms' }).notNull(),
    note: text('note'),
    /** Local file URI of an attached receipt/photo. */
    imageUri: text('image_uri'),
    ...timestamps,
  },
  (t) => [
    index('transactions_sub_idx').on(t.subcategoryId),
    index('transactions_lookup_idx').on(t.subcategoryId, t.period),
  ],
);

/**
 * Per-month status of one subcategory (a single bill) — the heart of the app.
 *
 * pending  not yet paid this month
 * paid     paid out of its account
 *
 * The legacy `transferred`/`completed` values still validate here so old rows
 * load; the repository maps them to `paid` on read, and only ever writes
 * `pending`/`paid`. Whether the *bulk* money has moved is a separate,
 * category-level fact (see `categoryStates`).
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
    status: text('status', { enum: ['pending', 'paid', 'transferred', 'completed'] })
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
 * Per-month status of a whole category's *bulk* transfer.
 *
 * pending      the bulk money (e.g. salary) has not yet been moved to the
 *              category's account this month
 * transferred  it has — the account now holds the money the bills draw on
 *
 * Independent of subcategory (bill) status: marking a category transferred
 * does not pay any bill, and it can be toggled back if it was a mis-tap.
 * Keyed by (categoryId, period).
 */
export const categoryStates = sqliteTable(
  'category_states',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** "YYYY-MM". */
    period: text('period').notNull(),
    status: text('status', { enum: ['pending', 'transferred'] })
      .notNull()
      .default('pending'),
    transferredAt: integer('transferred_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [index('category_states_lookup_idx').on(t.categoryId, t.period)],
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
  /** Lending institution, from the bank catalog — drives the loan card's brand. */
  bankId: text('bank_id'),
  principalMinor: integer('principal_minor').notNull(),
  /** Annual nominal rate as a percentage, e.g. 11.5 for 11.50%. */
  annualRatePct: real('annual_rate_pct').notNull(),
  termMonths: integer('term_months').notNull(),
  startDate: integer('start_date', { mode: 'timestamp_ms' }).notNull(),
  /**
   * Which installment number the borrower has *already reached* — 1 means the
   * loan is brand new, 6 means five have been paid and the 6th is next. Lets
   * the schedule show progress (paid vs. remaining) across the full term
   * instead of assuming every loan starts today. Defaults to 1.
   */
  paidInstallments: integer('paid_installments').notNull().default(0),
  color: text('color').notNull().default('#F97316'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
});

/**
 * Learned merchant → budget-line associations, the memory behind auto-detected
 * categories.
 *
 * A row says "SMS text matching `pattern` belongs to this line". Rows arrive
 * two ways: seeded from the static keyword list at first launch, and — the
 * point of the table — written whenever the user confirms or corrects a draft's
 * category. `hitCount` rises on every confirmation, so a repeatedly-confirmed
 * mapping outranks a one-off, and detection accuracy improves with use.
 *
 * `pattern` is normalised merchant text (see core/merchantRules.ts), not a
 * regex — it is compared by equality/containment, never executed.
 */
export const merchantRules = sqliteTable(
  'merchant_rules',
  {
    id: text('id').primaryKey(),
    /** Normalised merchant key this rule fires on. Unique across the table. */
    pattern: text('pattern').notNull(),
    /** The line to log against; null for a seed rule that only carries a hint. */
    subcategoryId: text('subcategory_id').references(() => subcategories.id, {
      onDelete: 'cascade',
    }),
    /** Semantic bucket, so the rule still helps after its line is deleted. */
    hint: text('hint'),
    /** 'seed' (shipped) or 'learned' (written from a user correction). */
    source: text('source', { enum: ['seed', 'learned'] })
      .notNull()
      .default('learned'),
    /** Times the user has confirmed this mapping — the confidence signal. */
    hitCount: integer('hit_count').notNull().default(1),
    ...timestamps,
  },
  (t) => [index('merchant_rules_pattern_idx').on(t.pattern)],
);

/**
 * The durable queue of bank messages waiting to be reviewed.
 *
 * Drafts used to live only in React state, which made the drain lossy in a way
 * that was invisible: the file was cleared first, so anything not confirmed
 * before the app was killed was gone for good, and the same message could be
 * re-imported after a restart because the duplicate check was in memory too.
 *
 * A row is written the moment a message is taken out of the file, and it stays
 * until the user acts on it. The parsed fields are stored alongside the raw text
 * so the review list renders without re-parsing, while `raw` keeps the original
 * for the confirm sheet to display — and for a future parser to re-read, which
 * matters because the parser is still learning bank formats.
 *
 * This holds real bank message text, so it is a direct reason the database must
 * not sit in a file-shared folder (see DATABASE_DIRECTORY in db/client.ts).
 */
export const smsInbox = sqliteTable(
  'sms_inbox',
  {
    id: text('id').primaryKey(),
    /** The message exactly as received — the source of truth for a re-parse. */
    raw: text('raw').notNull(),
    /**
     * Stable fingerprint of `raw`, uniquely indexed.
     *
     * This is what makes the queue idempotent: the drain can re-run after a
     * crash, and Shortcuts can append the same alert twice, without producing a
     * duplicate row. Derived rather than natural-keyed on `raw` itself because
     * an index over unbounded message text is wasteful.
     */
    fingerprint: text('fingerprint').notNull(),
    /**
     * pending    awaiting the user's Yes/Edit/No
     * confirmed  logged to a budget line; kept so the same SMS cannot re-import
     * dismissed  the user said it was not a transaction
     *
     * Acted-on rows are retained rather than deleted precisely so `fingerprint`
     * keeps rejecting repeats.
     */
    status: text('status', { enum: ['pending', 'confirmed', 'dismissed'] })
      .notNull()
      .default('pending'),
    /** Parsed movement, mirrored from ParsedSms so the list needs no re-parse. */
    direction: text('direction'),
    kind: text('kind'),
    amountMinor: integer('amount_minor'),
    /** ISO code the message stated, or null when it used a bare symbol. */
    currency: text('currency'),
    merchant: text('merchant'),
    /** Account/card fragment the message referenced, for matching a card. */
    account: text('account'),
    /** ISO "YYYY-MM-DD" the message referenced, or null. */
    occurredOn: text('occurred_on'),
    /** 24-hour "HH:MM" the message referenced, or null. */
    occurredAt: text('occurred_at'),
    /** When the app took this out of the file — the queue's ordering key. */
    receivedAt: integer('received_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /** Set when the row left `pending`, for pruning old acted-on rows. */
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [
    index('sms_inbox_status_idx').on(t.status, t.receivedAt),
  ],
);

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
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type SubcategoryState = typeof subcategoryStates.$inferSelect;
export type NewSubcategoryState = typeof subcategoryStates.$inferInsert;
export type CategoryState = typeof categoryStates.$inferSelect;
export type NewCategoryState = typeof categoryStates.$inferInsert;
export type Funding = typeof fundings.$inferSelect;
export type NewFunding = typeof fundings.$inferInsert;
export type Income = typeof incomes.$inferSelect;
export type NewIncome = typeof incomes.$inferInsert;
export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;
export type MerchantRuleRow = typeof merchantRules.$inferSelect;
export type NewMerchantRuleRow = typeof merchantRules.$inferInsert;
export type SmsInboxRow = typeof smsInbox.$inferSelect;
export type NewSmsInboxRow = typeof smsInbox.$inferInsert;

/** Where a queued message stands. See `smsInbox.status`. */
export type SmsInboxStatus = SmsInboxRow['status'];

/** How often a subcategory recurs. */
export type SubcategoryFrequency = Subcategory['frequency'];
export const SUBCATEGORY_FREQUENCIES: SubcategoryFrequency[] = [
  'monthly',
  'one_time',
  'yearly',
  'unplanned',
];

/**
 * Canonical human labels for every frequency — the single source of truth so
 * every picker in the app shows the same words in the same order. `category`
 * excludes `unplanned` (a category's *default* cadence for new bills; unplanned
 * is a per-bill choice made on the subcategory itself).
 */
export const FREQUENCY_LABEL: Record<SubcategoryFrequency, string> = {
  monthly: 'Monthly',
  one_time: 'One-time',
  yearly: 'Yearly',
  /*
   * "Unplanned" was the wrong word: these lines are very much planned — the
   * user sets a monthly budget for groceries — it is the individual *spends*
   * that are not known in advance. "Spending budget" says what the line is
   * (a pot you draw down) rather than describing it by what it lacks. The
   * stored enum value stays `unplanned` so no migration is needed.
   */
  unplanned: 'Spending budget',
};

/**
 * One line of help per cadence, shown under the picker. The spending-budget
 * option needs it most — it behaves differently from the other three (many
 * entries summed, never ticked "paid" as a whole) and that is not obvious
 * from a two-word label.
 */
export const FREQUENCY_HINT: Record<SubcategoryFrequency, string> = {
  monthly: 'The same bill every month.',
  one_time: 'A single cost, counted in one month only.',
  yearly: 'Once a year — you can save toward it monthly.',
  unplanned: 'A monthly budget you spend down entry by entry, like groceries.',
};

/** Frequencies offered as a category's default cadence (no unplanned). */
export const CATEGORY_DEFAULT_FREQUENCIES: SubcategoryFrequency[] = [
  'monthly',
  'one_time',
  'yearly',
];

/** True for frequencies that support the "save up for this" saving plan. Per
 * product rule, only yearly lines can save up toward a future due date. */
export function supportsSavingPlan(frequency: SubcategoryFrequency): boolean {
  return frequency === 'yearly';
}

/**
 * True for a "spending budget" line (stored as `unplanned`).
 *
 * Such a line holds many child transactions rather than one amount paid once,
 * and is never marked paid as a whole — its spend is the SUM of its entries.
 * It DOES carry a `plannedMinor`, though: that is the monthly budget the
 * entries are drawn against, which is what makes "Rs 8,400 of Rs 20,000" a
 * meaningful thing to show.
 */
export function isUnplanned(frequency: SubcategoryFrequency): boolean {
  return frequency === 'unplanned';
}

/**
 * The two states a bill (subcategory) moves through in a month, as seen above
 * the DB layer. The stored column still permits the legacy `transferred`/
 * `completed` values for old rows; the repository maps them to `paid` on read.
 */
export type SubcategoryStatus = 'pending' | 'paid';
export const SUBCATEGORY_STATUSES: SubcategoryStatus[] = ['pending', 'paid'];

/** The two states a category's bulk transfer moves through in a month. */
export type CategoryFundingStatus = CategoryState['status'];
export const CATEGORY_FUNDING_STATUSES: CategoryFundingStatus[] = ['pending', 'transferred'];
