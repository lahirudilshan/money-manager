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
   * THE only name the user types. There used to be a second `name` column as
   * well, so the form asked for a "full name" and a "short name" and the lists
   * had to decide between them; two fields for one question is what made three
   * HNB accounts read as three rows of "HNB". The bank supplies the identity
   * (`bankName` / the catalog's short name) and this supplies the distinction,
   * so nothing is lost by asking once.
   *
   * Null when the user has not named it, in which case `accountLabel` falls
   * back to the bank — which is exactly right for someone with one account per
   * bank, the case where a nickname is pure friction.
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
  /**
   * A SECOND account number, for the other currency this relationship holds.
   *
   * Sri Lankan banks split two ways on a foreign-currency account: some put
   * both currencies behind one number, some issue a separate number per
   * currency. The row therefore carries an optional second number and the
   * currency that goes with it, so the same entry covers both shapes — one
   * number means `foreignAccountNumber` is null and `currency` says what the
   * single account holds.
   *
   * This exists for MATCHING, not for funding. Bills still point at one card
   * and fund in the home currency; what the second number buys is the ability
   * to recognise a bank message about the foreign leg — which is what makes a
   * USD→LKR conversion between the user's own two numbers identifiable as an
   * internal move rather than a spend.
   */
  foreignAccountNumber: text('foreign_account_number'),
  /**
   * The currency behind `foreignAccountNumber` — "USD", "EUR".
   *
   * Held separately from `currency` (which describes the primary number)
   * because the pair is the point: one row can now say "this number is my LKR
   * side, that number is my USD side".
   */
  foreignCurrency: text('foreign_currency'),
  /** Last 4 of `foreignAccountNumber`, for SMS matching. */
  foreignLast4: text('foreign_last4'),
  branch: text('branch'),
  bankCode: text('bank_code'),
  /**
   * What this account HOLDS, as an ISO code — "LKR", "USD".
   *
   * Null on every row that predates this column, which is exactly right: those
   * were created when the app had one currency, so they are all in the user's
   * own money. `accountCurrency` resolves null to the home currency rather than
   * this defaulting to a literal, so changing the app's currency does not leave
   * old rows asserting the wrong one.
   *
   * This is what lets a bank's LKR savings and its USD FCBU account be two rows
   * that state what they are — and, where a bank puts both currencies behind
   * ONE number, two rows sharing a `last4`. The app deliberately does not model
   * the link between them: nothing it does needs to know, and a grouping the
   * user has to maintain is a setting that will go stale.
   *
   * Bills and categories still fund in the HOME currency. An account names one
   * currency and everything drawn from it uses that.
   */
  currency: text('currency'),
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
     * `ongoing` is special: the line has no single planned amount paid once a
     * period. Instead it holds many individual transactions (see the
     * `transactions` table), its "actual" is the SUM of those, and it is never
     * marked paid as a whole — the money is tracked entry by entry.
     *
     * Stored as `unplanned` before the rename; `ensureOngoingFrequency` in
     * client.ts rewrites those rows on launch.
     */
    frequency: text('frequency', { enum: ['monthly', 'one_time', 'yearly', 'ongoing'] })
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
     * Whether payments on this line are attributed to a HOUSE.
     *
     * Only some bills are per-property: electricity, water, rent and transfers
     * can each belong to a different house, while a Netflix subscription or a
     * loan installment cannot — asking which house a salary belongs to is
     * noise. So the picker appears only on lines that opt in here, which is what
     * keeps the feature invisible everywhere it does not apply.
     *
     * Defaulted from the line's category on creation (see
     * `HOUSE_SCOPED_CATALOG_IDS`), and overridable per line, because only the
     * user knows whether their "Repairs" line covers one house or several.
     */
    houseScoped: integer('house_scoped', { mode: 'boolean' }).notNull().default(false),

    /**
     * The house this line's payments belong to BY DEFAULT.
     *
     * A convenience, not the record: the authoritative per-payment attribution
     * lives on `transactions.houseId` / `subcategory_states.house_id`, because
     * one "Electricity" line legitimately pays for two houses in alternate
     * months. This just seeds the picker so the common case is zero taps.
     */
    houseId: text('house_id').references(() => houses.id, { onDelete: 'set null' }),

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
 * Individual money movements under an `ongoing` subcategory.
 *
 * A normal (monthly/yearly/one_time) subcategory has a single planned amount
 * paid once a period. An *ongoing* one (e.g. "Groceries", "Eating out") has
 * no fixed amount — it accumulates many small entries. Each row here is one
 * such entry; the subcategory's effective spend for a period is the SUM of its
 * transactions in that period. This is also where a confirmed SMS draft can be
 * logged when it maps to an ongoing line.
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
    /**
     * Which property this spend was for. Null when the line is not house-scoped,
     * or when only one house exists (in which case attribution is unambiguous
     * and the UI never asks). See `houses`.
     */
    houseId: text('house_id').references(() => houses.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('transactions_sub_idx').on(t.subcategoryId),
    index('transactions_lookup_idx').on(t.subcategoryId, t.period),
    // Per-house totals scan by house within a month — "what did Weligama cost
    // in August" is the question this feature exists to answer.
    index('transactions_house_idx').on(t.houseId, t.period),
  ],
);

/**
 * The parts of a SPLIT transaction — one real payment covering several budget
 * lines.
 *
 * A 5,000 shop at Keells is one debit on the bank statement and one SMS, but it
 * is not one budget line: 3,000 of it was groceries and 2,000 was pet food. The
 * naive fix — write two transactions — makes the app disagree with the bank
 * statement, and there is then no row that corresponds to the payment the user
 * actually made, so a receipt, a refund or a correction has nothing to attach
 * to.
 *
 * So the transaction stays whole and authoritative (`transactions.amountMinor`
 * is what left the account), and its allocation across lines lives here. A
 * transaction with NO rows here is unsplit and counts entirely against its own
 * `subcategoryId` — which is every transaction that existed before this table,
 * so nothing has to be backfilled.
 *
 * ## The invariant
 *
 * When rows do exist they must sum to the parent's `amountMinor` exactly. Minor
 * units make that checkable with integer arithmetic (see
 * `features/budget/logic/splits.ts`), and the UI never lets a split be saved
 * short — an unallocated remainder is silently missing money.
 *
 * `subcategoryId` here is deliberately NOT unique per transaction: two parts of
 * one payment can legitimately land on the same line if the user split by
 * receipt section rather than by category.
 */
export const transactionSplits = sqliteTable(
  'transaction_splits',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /** The budget line this part of the payment counts against. */
    subcategoryId: text('subcategory_id')
      .notNull()
      .references(() => subcategories.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
    /** What this part was, when the user named it — "pet food", "wine". */
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // Loading a transaction's parts, and the reverse: summing every part that
    // landed on one line, which is how a split contributes to a line's total.
    index('transaction_splits_txn_idx').on(t.transactionId),
    index('transaction_splits_sub_idx').on(t.subcategoryId),
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
    /**
     * Which property this month's payment was for, on a house-scoped line.
     *
     * Lives per-PERIOD rather than only on the subcategory because the same
     * "Electricity" line can pay a different house in different months, which is
     * precisely the user's situation. Null when the line is not house-scoped.
     */
    houseId: text('house_id').references(() => houses.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('subcategory_states_period_idx').on(t.period),
    index('subcategory_states_lookup_idx').on(t.subcategoryId, t.period),
    index('subcategory_states_house_idx').on(t.houseId, t.period),
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
  /**
   * How the lender charges the quoted rate. Two products, two different sums.
   *
   * `emi` — reducing balance. Interest is charged on what is still owed, so it
   * falls as the balance does. This is how banks quote personal loans and
   * mortgages, and it is the standard annuity/EMI formula.
   *
   * `flat` — interest is computed once on the FULL principal for the whole
   * term and split evenly across the installments, so it never falls. Common
   * for vehicle leases here, and materially more expensive: 7,200,000 at 11.5%
   * over 5 years is 158,347 a month reducing, but 189,000 a month flat.
   *
   * Defaults to `emi` because that is what every existing row was computed as;
   * a lease created from now on defaults to `flat` in the form.
   */
  interestMethod: text('interest_method', { enum: ['emi', 'flat'] })
    .notNull()
    .default('emi'),
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
 * Meter readings taken off utility statements — the usage history.
 *
 * A CEB e-bill states the meter pair and the units consumed for ONE period, and
 * that single figure answers nothing on its own: 189 units is only meaningful
 * next to the 210 the month before. So each statement's reading is kept as it
 * arrives, and the detail screen charts the series.
 *
 * Written from the SMS itself rather than from a confirmed transaction, and
 * deliberately so — the reading is a fact the utility stated, true whether or
 * not the user logs the bill against a budget line. Tying it to confirmation
 * would put a hole in the chart for every bill that was dismissed as a
 * duplicate.
 *
 * Keyed by (account, period): a re-delivered statement updates its row instead
 * of drawing the same month twice.
 */
export const meterReadings = sqliteTable(
  'meter_readings',
  {
    id: text('id').primaryKey(),
    /** The utility account — a house may have several meters. */
    accountNumber: text('account_number').notNull(),
    /** Which utility issued it, as named by `statementBiller`. */
    biller: text('biller').notNull(),
    /** "YYYY-MM" the reading belongs to, derived from the reading date. */
    period: text('period').notNull(),
    /** ISO "YYYY-MM-DD" the meter was read. */
    readingDate: text('reading_date'),
    /** Units consumed, as STATED by the biller — never recomputed. */
    units: integer('units'),
    /** The meter figures themselves, kept so a misread is diagnosable. */
    readingCurrent: integer('reading_current'),
    readingPrevious: integer('reading_previous'),
    /** What the statement asked for, so cost can be charted beside usage. */
    totalDueMinor: integer('total_due_minor'),
    /** This period's charge alone, excluding arrears. */
    monthlyBillMinor: integer('monthly_bill_minor'),
    ...timestamps,
  },
  (t) => [index('meter_readings_account_idx').on(t.accountNumber, t.period)],
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

/**
 * A property whose running costs the user pays — their own home, a parents'
 * house, a rented-out annexe.
 *
 * The motivating case: the user pays the electricity and water bills for their
 * parents' house in Weligama as well as their own. Both arrive as ordinary bank
 * alerts naming CEB and the water board, so without a house dimension the two
 * are indistinguishable and roll into one "Electricity" figure — which answers
 * neither "what does my house cost me" nor "what am I spending on my parents".
 *
 * Modelled as its own table rather than as extra categories ("Electricity —
 * Weligama", "Electricity — Home") because duplicating every utility line per
 * property multiplies the board, and because the interesting totals run BOTH
 * ways: per house across all bills, and per bill across all houses. A dimension
 * gives both; duplicated categories give neither without manual summing.
 *
 * `isPrimary` marks the user's own home. Exactly one house holds it (see
 * `houseRepo.setPrimary`), and it is what lets the UI stay invisible for the
 * overwhelmingly common single-house setup: with one house, everything belongs
 * to it and no picker is ever shown.
 */
export const houses = sqliteTable('houses', {
  id: text('id').primaryKey(),
  /** What the user calls it — "Home", "Weligama (parents)", "Colombo annexe". */
  name: text('name').notNull(),
  /**
   * The user's own residence. Used as the default for new transactions, and to
   * label the house in summaries. Enforced as a single winner by the repo
   * rather than by a constraint, since SQLite has no partial-unique in the DDL
   * this file generates.
   */
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  color: text('color').notNull().default('#0F6FDE'),
  icon: text('icon').notNull().default('home-outline'),
  /** Free-text, e.g. the town — shown under the name to tell two apart. */
  note: text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  ...timestamps,
});

/** Key/value app settings (currency, USD rate, onboarding marker). */
/**
 * A vehicle the fuel mini-app tracks. See core/miniApps.ts for why it is opt-in.
 *
 * Separate from `cards`/`categories` on purpose: a vehicle is not a money
 * object. It is the thing consumption is measured AGAINST, and every figure the
 * tracker reports — km/l, cost per km, distance since service — is meaningless
 * unless it is scoped to one vehicle. A car and a motorbike sharing a log would
 * average 45 km/l with 12 km/l into a number describing neither.
 */
export const vehicles = sqliteTable('vehicles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Plate, shown to tell two of the same model apart. Optional. */
  registration: text('registration'),
  kind: text('kind', { enum: ['car', 'bike', 'van', 'three_wheeler', 'other'] })
    .notNull()
    .default('car'),
  fuelType: text('fuel_type', { enum: ['petrol', 'diesel', 'hybrid', 'electric'] })
    .notNull()
    .default('petrol'),
  /** Usable tank size in litres, for "how full is this fill" context. Optional. */
  tankLitres: real('tank_litres'),
  /** Distance unit the odometer reads in — stats follow it. */
  odometerUnit: text('odometer_unit', { enum: ['km', 'mi'] })
    .notNull()
    .default('km'),
  color: text('color').notNull().default('#0E9F6E'),
  icon: text('icon').notNull().default('car-sport-outline'),
  /** Local file URI of a photo of the vehicle — see core/imageStorage.ts. */
  imageUri: text('image_uri'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/**
 * One visit to a filling station.
 *
 * `isFullTank` is the field the whole feature turns on. Real consumption can
 * only be measured between two FULL tanks — you know exactly how much was
 * burned because you know the tank was brim-full at both ends. A partial fill
 * gives litres but no such anchor, so it is summed into the window rather than
 * producing a figure of its own (see core/fuel.ts).
 *
 * `transactionId` is the money link. The cost lives ONCE, on the board, where
 * the bank SMS or a manual entry already put it — this only points at it. The
 * reference is `set null` rather than cascade so deleting a transaction leaves
 * the odometer history intact; losing a receipt must not lose the mileage.
 *
 * `totalMinor` is a fallback for a cash fill with nothing to link to, so the
 * cost stats still work when no transaction exists.
 */
export const fuelEntries = sqliteTable(
  'fuel_entries',
  {
    id: text('id').primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    filledAt: integer('filled_at', { mode: 'timestamp_ms' }).notNull(),
    /** Odometer reading at the pump, in the vehicle's unit. */
    odometer: real('odometer').notNull(),
    litres: real('litres').notNull(),
    isFullTank: integer('is_full_tank', { mode: 'boolean' }).notNull().default(true),
    /**
     * Set when the driver knows the tank was not empty-to-full in the usual way
     * — a missed fill-up, or fuel added from a can. Breaks the chain so a bogus
     * window is not reported as a real one.
     */
    missedPrevious: integer('missed_previous', { mode: 'boolean' }).notNull().default(false),
    pricePerLitreMinor: integer('price_per_litre_minor'),
    totalMinor: integer('total_minor'),
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    station: text('station'),
    note: text('note'),
    /**
     * The pump receipt.
     *
     * Worth keeping for a fill-up specifically: the odometer and litres are
     * typed from a slip that is otherwise thrown away, so the photo is the only
     * way to check a figure that later looks wrong.
     */
    imageUri: text('image_uri'),
    ...timestamps,
  },
  (t) => [
    index('fuel_entries_vehicle_idx').on(t.vehicleId),
    // The order every consumption calculation reads in.
    index('fuel_entries_odometer_idx').on(t.vehicleId, t.odometer),
  ],
);

/** A service, repair or other dated piece of vehicle upkeep. */
export const vehicleServices = sqliteTable(
  'vehicle_services',
  {
    id: text('id').primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    servicedAt: integer('serviced_at', { mode: 'timestamp_ms' }).notNull(),
    odometer: real('odometer'),
    kind: text('kind', {
      enum: ['service', 'repair', 'tyres', 'insurance', 'licence', 'other'],
    })
      .notNull()
      .default('service'),
    title: text('title').notNull(),
    costMinor: integer('cost_minor'),
    /** Same money link as a fill-up — see `fuelEntries.transactionId`. */
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    /** Either may be set, so "due in 5,000 km" and "due in March" both work. */
    nextDueOdometer: real('next_due_odometer'),
    nextDueDate: integer('next_due_date', { mode: 'timestamp_ms' }),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('vehicle_services_vehicle_idx').on(t.vehicleId)],
);

/**
 * One line on a service bill — a part, a fluid, or labour.
 *
 * A garage invoice is a list, not a single figure: "oil filter 2,400, 5W-30 x4
 * 9,600, labour 6,500". Storing only the total answers "what did I spend" but
 * not the question anyone actually returns to a service record for — WHICH
 * parts were changed, and how long ago. Knowing the air filter was done 8,000
 * km back is the whole reason to keep the record.
 *
 * The parent's `costMinor` stays as the authoritative total, because a real
 * invoice carries taxes and discounts that the lines do not sum to. Where the
 * user has itemised, the UI shows both and says when they disagree.
 */
export const serviceItems = sqliteTable(
  'service_items',
  {
    id: text('id').primaryKey(),
    serviceId: text('service_id')
      .notNull()
      .references(() => vehicleServices.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Parts are counted, labour is not — defaults to 1 so it can be ignored. */
    quantity: real('quantity').notNull().default(1),
    /** Per-unit price; the row's total is this times `quantity`. */
    unitPriceMinor: integer('unit_price_minor').notNull().default(0),
    kind: text('kind', { enum: ['part', 'fluid', 'labour', 'other'] })
      .notNull()
      .default('part'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('service_items_service_idx').on(t.serviceId)],
);

/*
 * ---------------------------------------------------------------------------
 * Health mini-app — see core/miniApps.ts for why it is opt-in.
 *
 * The most sensitive data this app holds, by a distance. Two consequences run
 * through every table below:
 *
 *   1. It is OFF by default and these tables stay empty until someone asks for
 *      it, exactly like the fuel tables above.
 *   2. It is a `sensitive` backup part (see core/backup.ts), so a medical
 *      history never reaches Google Drive because a default said so.
 *
 * The organising idea is a TIMELINE per person. Medicines, visits, documents
 * and readings are four different shapes of record, but the question people
 * actually ask — "what has been happening with Amma?" — is answered by putting
 * them on one dated axis, not by four separate lists. Each table therefore
 * carries a person and a timestamp, which is what lets core/health.ts merge
 * them without special cases.
 * ---------------------------------------------------------------------------
 */

/**
 * A person whose health is tracked — the user, a parent, a child.
 *
 * Deliberately its own table rather than a text field on each record. A family
 * member is referenced from four places, and the whole premise ("one place to
 * see all health records") depends on being able to filter every one of them by
 * the same person. Free text would make "Amma" and "amma" two people.
 *
 * `isSelf` marks the phone's owner, so the timeline can open on them rather
 * than asking who you are every time — the same trick `houses.isPrimary` uses
 * to stay invisible in the common single-person case.
 */
export const healthPeople = sqliteTable('health_people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /**
   * How this person relates to the phone's owner, picked from a list.
   *
   * An enum rather than free text, and `self` is one of the options. Typed
   * relations made "Mother", "mother" and "Amma" three different things in a
   * list whose whole job is telling a handful of people apart — and left the
   * user with no way to say which one was them, since `isSelf` was set silently
   * by the store on the first person added.
   *
   * Picking "Myself" IS that declaration now: `healthPersonRepo` keeps the flag
   * and this column in step, so there is one answer to "who am I?" rather than
   * a hidden boolean and a string that might disagree with it.
   *
   * `other` is the escape hatch for a relation the list does not name — a
   * grandparent-in-law, a ward — and pairs with `relationLabel` below so those
   * cases keep their own word rather than being forced into a wrong one.
   */
  relation: text('relation', {
    enum: [
      'self',
      'spouse',
      'mother',
      'father',
      'daughter',
      'son',
      'sister',
      'brother',
      'grandmother',
      'grandfather',
      'other',
    ],
  }),
  /**
   * The user's own word, used only when `relation` is `other`.
   *
   * Kept separate from `relation` rather than overloading it, so the enum stays
   * an enum — a column that is sometimes a key and sometimes a label cannot be
   * filtered or counted on.
   */
  relationLabel: text('relation_label'),
  /**
   * Date of birth, for the age shown beside a reading.
   *
   * Optional, and stored rather than an age: an age is wrong a year later, and
   * a blood-pressure figure from 2019 means something different at 58 than the
   * same number does at 64.
   */
  bornOn: integer('born_on', { mode: 'timestamp_ms' }),
  /**
   * Blood group and allergies, kept ON the person rather than in a note.
   *
   * These are the two facts someone opens this app for in an emergency, when
   * scrolling a timeline is exactly what they cannot do. Surfaced at the top of
   * the person's screen for that reason.
   */
  bloodGroup: text('blood_group'),
  allergies: text('allergies'),
  /** Long-term conditions — "Type 2 diabetes, hypertension". */
  conditions: text('conditions'),
  note: text('note'),
  color: text('color').notNull().default('#D6336C'),
  icon: text('icon').notNull().default('person-outline'),
  /** Local file URI of a photo — see core/imageStorage.ts. */
  imageUri: text('image_uri'),
  isSelf: integer('is_self', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/**
 * A medicine that was prescribed — a line on a prescription, not a tracker.
 *
 * Deliberately NOT a dose log. An earlier version recorded every tablet taken
 * and scored adherence out of it, which is a different product: it demands
 * input several times a day, every day, and the people who actually keep family
 * health records do not do that. They see a doctor, get a prescription, and
 * want to know months later what was prescribed and by whom.
 *
 * So this answers exactly one question — "what was Amma put on, and when?" —
 * and is written once, at the visit, from the paper in your hand.
 *
 * `visitId` ties it to the consultation that produced it, which is what makes
 * the doctor's name and diagnosis available without duplicating them here.
 * Null for a medicine recorded on its own (something long-standing, entered
 * when the record was first set up).
 *
 * `endedOn` null means still being taken. A finished course is kept rather than
 * deleted, because "what antibiotic was she on in March?" is a real question a
 * year later.
 */
export const healthMedicines = sqliteTable(
  'health_medicines',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => healthPeople.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** "500 mg", "10 ml" — free text, because real labels are not parseable. */
    dosage: text('dosage'),
    /** "Metformin" under a brand name, so two brands of one drug are spottable. */
    genericName: text('generic_name'),
    form: text('form', {
      enum: ['tablet', 'capsule', 'syrup', 'injection', 'inhaler', 'drops', 'cream', 'other'],
    })
      .notNull()
      .default('tablet'),
    /**
     * How to take it, in the doctor's own words.
     *
     * Free text — "twice a day after meals", "one at night" — because that is
     * what is written on the prescription and copying it verbatim is both the
     * fastest thing to type and the most faithful record. An earlier version
     * made this a machine-readable enum so the app could work out whether a
     * dose had been missed; nothing needs that now, and forcing real
     * instructions into eight fixed options lost detail for no gain.
     */
    instructions: text('instructions'),
    startedOn: integer('started_on', { mode: 'timestamp_ms' }),
    /** Null while still being taken; set when the course finished. */
    endedOn: integer('ended_on', { mode: 'timestamp_ms' }),
    /** Who prescribed it, and the visit it came from. */
    prescribedBy: text('prescribed_by'),
    visitId: text('visit_id').references(() => healthVisits.id, { onDelete: 'set null' }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('health_medicines_person_idx').on(t.personId),
    index('health_medicines_visit_idx').on(t.visitId),
  ],
);

/**
 * A visit to a doctor, hospital, lab or dentist.
 *
 * The anchor most other records hang off: a prescription comes FROM a visit, a
 * report is the RESULT of one. `costMinor` and `transactionId` follow the fuel
 * mini-app's money link exactly — the cost lives once, on the board, and this
 * only points at it (see `fuelEntries.transactionId`).
 */
export const healthVisits = sqliteTable(
  'health_visits',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => healthPeople.id, { onDelete: 'cascade' }),
    visitedAt: integer('visited_at', { mode: 'timestamp_ms' }).notNull(),
    kind: text('kind', {
      enum: ['consultation', 'checkup', 'lab', 'dental', 'emergency', 'vaccination', 'therapy', 'other'],
    })
      .notNull()
      .default('consultation'),
    /** "Dr Perera" / "Nawaloka Hospital" — both worth keeping, separately. */
    doctor: text('doctor'),
    facility: text('facility'),
    speciality: text('speciality'),
    reason: text('reason'),
    diagnosis: text('diagnosis'),
    note: text('note'),
    costMinor: integer('cost_minor'),
    /** Same money link as a fill-up — see `fuelEntries.transactionId`. */
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    /**
     * The next appointment, when one was given.
     *
     * Drives the "coming up" band at the top of the timeline. A follow-up told
     * to you in a consulting room and written on a card is exactly the thing
     * that gets lost.
     */
    followUpOn: integer('follow_up_on', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => [
    index('health_visits_person_idx').on(t.personId, t.visitedAt),
    index('health_visits_follow_up_idx').on(t.followUpOn),
  ],
);

/**
 * A photographed prescription, report, scan or bill.
 *
 * The paper problem is the real one this feature solves: prescriptions and lab
 * reports arrive as physical sheets that are lost within a year, and the phone
 * camera is already how people half-solve it — into a photo library where the
 * report is indistinguishable from a screenshot six months later.
 *
 * `visitId` is optional so a document can be filed on its own (a report that
 * arrived by email) but attaches to its visit when there is one.
 */
export const healthDocuments = sqliteTable(
  'health_documents',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => healthPeople.id, { onDelete: 'cascade' }),
    visitId: text('visit_id').references(() => healthVisits.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    kind: text('kind', {
      enum: ['prescription', 'report', 'scan', 'bill', 'insurance', 'vaccination', 'other'],
    })
      .notNull()
      .default('report'),
    /** Local file URI — see core/imageStorage.ts. Stays on the device. */
    imageUri: text('image_uri'),
    /** When the document is DATED, which is not when it was photographed. */
    documentDate: integer('document_date', { mode: 'timestamp_ms' }).notNull(),
    /** Free text lifted off the page, so a report is findable by what it says. */
    summary: text('summary'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('health_documents_person_idx').on(t.personId, t.documentDate),
    index('health_documents_visit_idx').on(t.visitId),
  ],
);

/**
 * One measured reading — blood pressure, sugar, weight, cholesterol.
 *
 * A single generic table rather than one per metric. The alternative would need
 * a migration for every new thing someone wants to track, and every screen
 * would grow a branch; here a new metric is one entry in `HEALTH_METRIC_LABEL`.
 *
 * Blood pressure is why `valueSecondary` exists: it is the one common reading
 * that is genuinely two numbers (120/80), and storing it as two rows would
 * break the pairing that makes it meaningful.
 */
export const healthReadings = sqliteTable(
  'health_readings',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => healthPeople.id, { onDelete: 'cascade' }),
    /** Optional link to the visit or lab report the figure came from. */
    visitId: text('visit_id').references(() => healthVisits.id, { onDelete: 'set null' }),
    metric: text('metric', {
      enum: [
        'blood_pressure',
        'blood_sugar',
        'weight',
        'heart_rate',
        'temperature',
        'cholesterol',
        'oxygen',
        'hba1c',
        'other',
      ],
    })
      .notNull()
      .default('blood_pressure'),
    /** The reading itself. Systolic, for blood pressure. */
    value: real('value').notNull(),
    /** Diastolic — only blood pressure uses it. */
    valueSecondary: real('value_secondary'),
    /** Stored per row: someone may record weight in kg and a doctor in lb. */
    unit: text('unit'),
    measuredAt: integer('measured_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Context that changes what the number MEANS.
     *
     * A blood sugar of 140 is unremarkable after lunch and a problem fasting,
     * so a trend line mixing the two is worse than no trend at all.
     */
    context: text('context', { enum: ['fasting', 'post_meal', 'random', 'morning', 'night'] }),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    // Every chart reads one metric for one person, in date order.
    index('health_readings_person_idx').on(t.personId, t.metric, t.measuredAt),
  ],
);

/**
 * Buddy loans mini-app — see shared/lib/miniApps.ts. Opt-in, so these tables
 * stay empty on a device that never enables it.
 *
 * Deliberately separate from `loans`, which models a BANK product: principal,
 * interest, an amortisation schedule, a fixed monthly installment. None of that
 * applies when a neighbour asks for 5,000 in cash and says they will return it
 * "sometime next month". The facts worth keeping are who, how much, when it
 * went out, and what has come back — so this is its own small table rather than
 * a pile of nullable columns bolted onto a schedule it does not have.
 */
export const buddyLoans = sqliteTable(
  'buddy_loans',
  {
    id: text('id').primaryKey(),
    /**
     * Free text, not a reference to a `health_people` row.
     *
     * The people involved here overlap barely at all with the family the health
     * add-on tracks, and forcing a person record first would put a form in
     * front of someone trying to note down a loan in ten seconds.
     */
    personName: text('person_name').notNull(),
    /**
     * UNUSED — no screen reads or writes this.
     *
     * A phone number was on the form and came off it: the contact is already in
     * the phone's own address book under the same name, so re-typing it here
     * was a field to fill in for something a tap on the name already does
     * better.
     *
     * The column stays because SQLite cannot drop one without rebuilding the
     * table, and a nullable column nothing writes costs nothing. Anything
     * stored by an earlier build is still here if this is ever wanted back.
     */
    personContact: text('person_contact'),
    amountMinor: integer('amount_minor').notNull(),
    /** Which way the money went — the user can also be the borrower. */
    direction: text('direction', { enum: ['lent', 'borrowed'] })
      .notNull()
      .default('lent'),
    /** Cash, or a transfer that will show on a statement. */
    method: text('method', { enum: ['cash', 'transfer', 'other'] })
      .notNull()
      .default('cash'),
    lentOn: integer('lent_on', { mode: 'timestamp_ms' }).notNull(),
    /**
     * NULLABLE on purpose.
     *
     * Plenty of these are handed over with no agreed date, and inventing one
     * would put a reminder on the dashboard about a promise nobody made. A
     * record without a date simply never becomes a reminder — see
     * `dueBuddyLoans`.
     */
    dueOn: integer('due_on', { mode: 'timestamp_ms' }),
    /**
     * `written_off` is an OUTCOME, not a missing value.
     *
     * Money that is not coming back is a fact worth keeping: deleting the row
     * would erase who did not repay, and marking it paid would flatter the
     * totals. It keeps its own state, drops out of reminders, and is reported
     * on its own line.
     */
    status: text('status', { enum: ['outstanding', 'paid', 'written_off'] })
      .notNull()
      .default('outstanding'),
    /** When it was settled or written off, for the history. */
    closedOn: integer('closed_on', { mode: 'timestamp_ms' }),
    /** Local file URI — see shared/lib/imageStorage.ts. Stays on the device. */
    imageUri: text('image_uri'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    // The add-on's list, and the reminder sweep, both read by status then date.
    index('buddy_loans_status_idx').on(t.status, t.dueOn),
  ],
);

/**
 * One repayment against a buddy loan.
 *
 * Separate rows rather than a running `repaidMinor` column, because a stored
 * total is one write away from disagreeing with the history beneath it. What is
 * still owed is DERIVED — see `remainingMinor` — so deleting a mistaken
 * repayment corrects the balance automatically instead of leaving it wrong.
 */
export const buddyRepayments = sqliteTable(
  'buddy_repayments',
  {
    id: text('id').primaryKey(),
    loanId: text('loan_id')
      .notNull()
      .references(() => buddyLoans.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
    paidOn: integer('paid_on', { mode: 'timestamp_ms' }).notNull(),
    /** A photo of the slip, same as the loan itself may carry. */
    imageUri: text('image_uri'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('buddy_repayments_loan_idx').on(t.loanId, t.paidOn)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type House = typeof houses.$inferSelect;
export type NewHouse = typeof houses.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Subcategory = typeof subcategories.$inferSelect;
export type NewSubcategory = typeof subcategories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type NewTransactionSplit = typeof transactionSplits.$inferInsert;
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
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type FuelEntry = typeof fuelEntries.$inferSelect;
export type NewFuelEntry = typeof fuelEntries.$inferInsert;
export type ServiceItem = typeof serviceItems.$inferSelect;
export type NewServiceItem = typeof serviceItems.$inferInsert;
export type ServiceItemKind = ServiceItem['kind'];

export const SERVICE_ITEM_KIND_LABEL: Record<ServiceItemKind, string> = {
  part: 'Part',
  fluid: 'Fluid',
  labour: 'Labour',
  other: 'Other',
};

export type VehicleService = typeof vehicleServices.$inferSelect;
export type NewVehicleService = typeof vehicleServices.$inferInsert;

/** What a vehicle is, for the picker and its icon. */
export type VehicleKind = Vehicle['kind'];
export type FuelType = Vehicle['fuelType'];
export type OdometerUnit = Vehicle['odometerUnit'];
export type ServiceKind = VehicleService['kind'];

export const VEHICLE_KIND_LABEL: Record<VehicleKind, string> = {
  car: 'Car',
  bike: 'Motorbike',
  van: 'Van',
  three_wheeler: 'Three-wheeler',
  other: 'Other',
};

export const FUEL_TYPE_LABEL: Record<FuelType, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  hybrid: 'Hybrid',
  electric: 'Electric',
};

export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  service: 'Service',
  repair: 'Repair',
  tyres: 'Tyres',
  insurance: 'Insurance',
  licence: 'Licence',
  other: 'Other',
};

export type HealthPerson = typeof healthPeople.$inferSelect;
export type NewHealthPerson = typeof healthPeople.$inferInsert;
export type HealthMedicine = typeof healthMedicines.$inferSelect;
export type NewHealthMedicine = typeof healthMedicines.$inferInsert;
export type HealthVisit = typeof healthVisits.$inferSelect;
export type NewHealthVisit = typeof healthVisits.$inferInsert;
export type HealthDocument = typeof healthDocuments.$inferSelect;
export type NewHealthDocument = typeof healthDocuments.$inferInsert;
export type HealthReading = typeof healthReadings.$inferSelect;
export type NewHealthReading = typeof healthReadings.$inferInsert;

export type BuddyLoan = typeof buddyLoans.$inferSelect;
export type NewBuddyLoan = typeof buddyLoans.$inferInsert;
export type BuddyRepayment = typeof buddyRepayments.$inferSelect;
export type NewBuddyRepayment = typeof buddyRepayments.$inferInsert;

/**
 * The eight blood groups, in the order they are normally listed.
 *
 * A closed set, so it is picked rather than typed. This is the one field in the
 * app where a typo could matter in an emergency — "0+" for "O+", or "O+ve" —
 * and a free-text box invited exactly that. Stored as the plain string so the
 * column needs no migration and an old hand-typed value still reads back.
 */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** Whether a stored value is one of the eight — old rows may hold anything. */
export function isBloodGroup(value: string | null | undefined): value is BloodGroup {
  return BLOOD_GROUPS.includes(value as BloodGroup);
}

export type PersonRelation = NonNullable<HealthPerson['relation']>;

/**
 * The relations offered, in the order a family list is usually built.
 *
 * "Myself" leads because the person adding the app is almost always the first
 * entry, and because it is the one option that also answers "who is the phone's
 * owner?" — see `healthPeople.relation`.
 */
export const PERSON_RELATIONS: PersonRelation[] = [
  'self',
  'spouse',
  'mother',
  'father',
  'daughter',
  'son',
  'sister',
  'brother',
  'grandmother',
  'grandfather',
  'other',
];

export const PERSON_RELATION_LABEL: Record<PersonRelation, string> = {
  self: 'Myself',
  spouse: 'Spouse',
  mother: 'Mother',
  father: 'Father',
  daughter: 'Daughter',
  son: 'Son',
  sister: 'Sister',
  brother: 'Brother',
  grandmother: 'Grandmother',
  grandfather: 'Grandfather',
  other: 'Other',
};

/**
 * What to show under a person's name.
 *
 * Falls back through the user's own word for `other`, then to nothing at all —
 * an unset relation shows no subtitle rather than the word "Other", which reads
 * as a category the user chose when in fact they skipped the question.
 */
export function relationLabel(
  person: Pick<HealthPerson, 'relation' | 'relationLabel'>,
): string | null {
  if (!person.relation) return null;
  if (person.relation === 'other') return person.relationLabel?.trim() || null;
  return PERSON_RELATION_LABEL[person.relation];
}

export type MedicineForm = HealthMedicine['form'];
export type VisitKind = HealthVisit['kind'];
export type DocumentKind = HealthDocument['kind'];
export type HealthMetric = HealthReading['metric'];
export type ReadingContext = NonNullable<HealthReading['context']>;

export const MEDICINE_FORM_LABEL: Record<MedicineForm, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  syrup: 'Syrup',
  injection: 'Injection',
  inhaler: 'Inhaler',
  drops: 'Drops',
  cream: 'Cream',
  other: 'Other',
};

export const VISIT_KIND_LABEL: Record<VisitKind, string> = {
  consultation: 'Consultation',
  checkup: 'Check-up',
  lab: 'Lab test',
  dental: 'Dental',
  emergency: 'Emergency',
  vaccination: 'Vaccination',
  therapy: 'Therapy',
  other: 'Other',
};

export const VISIT_KIND_ICON: Record<VisitKind, string> = {
  consultation: 'medkit-outline',
  checkup: 'clipboard-outline',
  lab: 'flask-outline',
  dental: 'happy-outline',
  emergency: 'alert-circle-outline',
  vaccination: 'shield-checkmark-outline',
  therapy: 'fitness-outline',
  other: 'ellipsis-horizontal-outline',
};

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  prescription: 'Prescription',
  report: 'Report',
  scan: 'Scan',
  bill: 'Bill',
  insurance: 'Insurance',
  vaccination: 'Vaccination card',
  other: 'Other',
};

export const HEALTH_METRIC_LABEL: Record<HealthMetric, string> = {
  blood_pressure: 'Blood pressure',
  blood_sugar: 'Blood sugar',
  weight: 'Weight',
  heart_rate: 'Heart rate',
  temperature: 'Temperature',
  cholesterol: 'Cholesterol',
  oxygen: 'Oxygen',
  hba1c: 'HbA1c',
  other: 'Other',
};

/** The unit a metric is normally recorded in, pre-filled on the form. */
export const HEALTH_METRIC_UNIT: Record<HealthMetric, string> = {
  blood_pressure: 'mmHg',
  blood_sugar: 'mg/dL',
  weight: 'kg',
  heart_rate: 'bpm',
  temperature: '°C',
  cholesterol: 'mg/dL',
  oxygen: '%',
  hba1c: '%',
  other: '',
};

/** True for the one metric that is genuinely two numbers (120/80). */
export function isPairedMetric(metric: HealthMetric): boolean {
  return metric === 'blood_pressure';
}

export const READING_CONTEXT_LABEL: Record<ReadingContext, string> = {
  fasting: 'Fasting',
  post_meal: 'After meal',
  random: 'Random',
  morning: 'Morning',
  night: 'Night',
};

export type SmsInboxRow = typeof smsInbox.$inferSelect;
export type NewSmsInboxRow = typeof smsInbox.$inferInsert;

export type MeterReading = typeof meterReadings.$inferSelect;
export type NewMeterReading = typeof meterReadings.$inferInsert;

/** Where a queued message stands. See `smsInbox.status`. */
export type SmsInboxStatus = SmsInboxRow['status'];

/** How often a subcategory recurs. */
export type SubcategoryFrequency = Subcategory['frequency'];
export const SUBCATEGORY_FREQUENCIES: SubcategoryFrequency[] = [
  'monthly',
  'one_time',
  'yearly',
  'ongoing',
];

/**
 * Canonical human labels for every frequency — the single source of truth so
 * every picker in the app shows the same words in the same order. `category`
 * excludes `ongoing` (a category's *default* cadence for new bills; ongoing
 * is a per-bill choice made on the subcategory itself).
 */
export const FREQUENCY_LABEL: Record<SubcategoryFrequency, string> = {
  monthly: 'Monthly',
  one_time: 'One-time',
  yearly: 'Yearly',
  /*
   * "Unplanned" was the wrong word: these lines are very much planned — the
   * user sets a monthly budget for groceries — it is the individual *spends*
   * that are not known in advance. "Ongoing" says what the line does (it keeps
   * happening rather than landing on a schedule) and sits on the same axis as
   * its three siblings, which all describe a payment pattern.
   */
  ongoing: 'Ongoing',
};

/**
 * Pill-sized labels, for pickers that put every option on one row.
 *
 * Currently identical to `FREQUENCY_LABEL` — every label is short enough to sit
 * beside its siblings. Kept as its own map so a future label too long for a
 * pill has somewhere to be shortened without splitting the wording used in
 * prose and in accessibility labels.
 */
/**
 * The icon for a loan's board line and its card on the Loans tab, by kind.
 *
 * Shared so the two never drift: the line is created in the store, the card is
 * rendered on the tab, and they are the same loan. Per KIND rather than one
 * debt mark, so a lease and a mortgage are told apart at a glance — and so no
 * line wears `cash-outline`, which belongs to the Debt category above them.
 */
export const LOAN_LINE_ICON: Record<string, string> = {
  personal: 'person-outline',
  lease: 'car-sport-outline',
  mortgage: 'home-outline',
  other: 'ellipsis-horizontal',
};

export const FREQUENCY_SHORT_LABEL: Record<SubcategoryFrequency, string> = {
  ...FREQUENCY_LABEL,
};

/**
 * One line of help per cadence, shown under the picker. The ongoing option
 * needs it most — it behaves differently from the other three (many entries
 * summed, never ticked "paid" as a whole) and that is not obvious from a
 * one-word label.
 */
export const FREQUENCY_HINT: Record<SubcategoryFrequency, string> = {
  /*
   * Each hint leads with how many payments the line takes in a month, because
   * that is the real difference between them and the thing a two-word pill
   * cannot carry: a bill is settled once, a budget accumulates.
   */
  monthly: 'One payment a month, on a date — ticked off when paid.',
  one_time: 'A single cost, counted in one month only.',
  yearly: 'Once a year — you can save toward it monthly.',
  ongoing: 'Many charges through the month, added up against a monthly amount.',
};

/** Frequencies offered as a category's default cadence (no ongoing). */
export const CATEGORY_DEFAULT_FREQUENCIES: SubcategoryFrequency[] = [
  'monthly',
  'one_time',
  'yearly',
];

/**
 * True for a line whose amount is contractually fixed.
 *
 * The gate for exact-amount SMS matching: a lease or loan installment is the
 * same figure every month, so a bank alert landing on it to the cent is strong
 * evidence, whereas a utility hitting its estimate exactly is coincidence.
 *
 * Derived from `loanId` alone rather than a user-set field. A line created from
 * the loan table IS an installment by construction, which is the case this
 * matters for; asking the user to classify every other bill was a question that
 * did not earn its place on the form.
 */
export function isFixedAmount(subcategory: Pick<Subcategory, 'loanId'>): boolean {
  return subcategory.loanId !== null;
}

/** True for frequencies that support the "save up for this" saving plan. Per
 * product rule, only yearly lines can save up toward a future due date. */
export function supportsSavingPlan(frequency: SubcategoryFrequency): boolean {
  return frequency === 'yearly';
}

/**
 * True for an "ongoing" line.
 *
 * Such a line holds many child transactions rather than one amount paid once,
 * and is never marked paid as a whole — its spend is the SUM of its entries.
 * It DOES carry a `plannedMinor`, though: that is the monthly budget the
 * entries are drawn against, which is what makes "Rs 8,400 of Rs 20,000" a
 * meaningful thing to show.
 */
export function isOngoing(frequency: SubcategoryFrequency): boolean {
  return frequency === 'ongoing';
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
