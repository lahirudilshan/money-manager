import { create } from 'zustand';
import { createSmsSlice } from '~/store/smsSlice';
import { createActionsSelector, type ActionsOf } from '~/store/selectActions';
import { buildSchedule, paymentsElapsed, remainingBalance } from '~/features/loans/logic/amortization';
import { setDisplayCurrency, sumMinor, type Minor } from '~/shared/lib/money';
import type { PlanId } from '~/features/budget/logic/plans';
import {
  hasSiblingTie,
  nextSiblingSortOrder,
} from '~/features/budget/logic/sortOrder';
import { isFullyRepaid } from '~/features/buddyloans/logic/buddyLoans';
import { buddyLoanRepo, buddyRepaymentRepo } from '~/db/repositories/buddyLoans';
import { deletePersistedImage } from '~/shared/lib/imageStorage';

/**
 * A stored repayment row, as the pure logic wants to see it.
 *
 * The logic module deliberately knows nothing about Drizzle's row types, so the
 * two are bridged here rather than by widening its signatures.
 */
function toRepaymentLike(row: BuddyRepayment) {
  return { id: row.id, amountMinor: row.amountMinor, paidOn: row.paidOn };
}
import {
  calculateRatios,
  daysUntil,
  dueDateFor,
  isFlexibleDueDay,
  isSpend,
  monthlyAmount,
  nextDueDate,
  savingPlanProgress,
  type SavingPlan,
  type SavingPlanProgress,
  nextStatus,
  periodKey,
  resolveCardId,
  summariseBoard,
  summariseCategory,
  urgencyFor,
  type BoardTotals,
  type CategorySummary,
  type DueUrgency,
  type PlannedCategory,
  type Ratios,
  type SubcategoryStatus,
} from '~/features/budget/logic/planning';
import { resolveBrand } from '~/shared/data/banks';
import { suggestCategoryIcon } from '~/shared/data/categoryIcons';
import { groupColors } from '~/shared/theme';
import {
  extractStatementBill,
  isRejectedAsNoise,
  looksTruncated,
  parseSms,
  splitItemisedFee,
  type ParsedSms,
} from '~/features/sms/logic/smsParser';
import {
  isBankChargeLine,
  orderDraftsWithFees,
  reconcileSms,
  type SmsDraft,
} from '~/features/sms/logic/smsReconcile';
import { merchantKey, planRuleUpsert, type MerchantRule } from '~/features/sms/logic/merchantRules';
import { observationsFrom, planCatalogMerge } from '~/features/sms/logic/catalogSync';
import {
  findGroupForProposal,
  findLineForHint,
  proposalForHint,
} from '~/features/sms/logic/hintCatalog';
import type { CategoryHint } from '~/features/sms/logic/smsCategoryHints';
import { logSmsIntake } from '~/features/sms/logic/smsIntakeLog';
import { isCatalogConfigured, pullRules, pushObservations } from '~/shared/lib/catalogApi';
import { getDeviceId } from '~/shared/lib/deviceId';
import { onForeground, onNetworkRestored } from '~/shared/lib/network';
import {
  cancelInternalTransfers,
  cancelReversals,
  inferOwnAccounts,
  splitMergedMessages,
  EMPTY_SUMMARY,
  fingerprintMessage,
  type DrainSummary,
} from '~/features/sms/logic/smsInbox';
import {
  countWaiting,
  drainInbox,
  ensureInboxExists,
  migrateLegacyInbox,
  watchInbox,
} from '~/features/sms/logic/smsInboxFile';
import { DEBT_CATEGORY_ID, initialiseDatabase, resetDatabase } from '../db/client';
import {
  cardRepo,
  categoryRepo,
  houseRepo,
  categoryStateRepo,
  fundingRepo,
  incomeRepo,
  loanRepo,
  merchantRuleRepo,
  meterReadingRepo,
  settingsRepo,
  smsInboxRepo,
  smsLogRepo,
  stateRepo,
  subcategoryRepo,
  vehicleRepo,
  healthPersonRepo,
  transactionRepo,
  SETTINGS_KEYS,
} from '../db/repositories';
import { seedSampleTemplate } from '../db/seed';
import { seedFuelSample } from '~/features/fuel/logic/seedFuel';
import { seedHealthSample } from '~/features/health/logic/seedHealth';
import {
  cancelAllReminders,
  notifyDraftsImported,
} from '~/shared/lib/notifications';
import {
  isOngoing,
  LOAN_LINE_ICON,
  supportsSavingPlan,
  type NewVehicle,
  type Vehicle,
  type HealthPerson,
  type BuddyLoan,
  type BuddyRepayment,
  type NewBuddyLoan,
  type NewBuddyRepayment,
  type NewHealthPerson,
} from '../db/schema';
import { isHouseScopedHint, isHouseScopedName, PLACEHOLDER_HOUSES } from '~/features/budget/logic/houses';
import { toggleMiniApp, type MiniAppId } from '~/shared/lib/miniApps';
import { readCachedRates } from '~/features/rates/logic/bankRatesApi';
import type { BankRate } from '~/features/rates/logic/bankRates';
import type {
  Card,
  Category,
  House,
  NewHouse,
  CategoryFundingStatus,
  CategoryState,
  Income,
  Loan,
  NewCard,
  NewCategory,
  NewIncome,
  NewLoan,
  NewSubcategory,
  NewTransaction,
  Subcategory,
  SubcategoryState,
  Transaction,
} from '../db/schema';

/**
 * Screen state. SQLite reads here are synchronous and fast, so the store keeps
 * plain arrays and re-reads after every mutation — derived values can never
 * drift from the database, at the cost of a full refresh per write.
 */

export interface AppState {
  ready: boolean;
  needsOnboarding: boolean;
  period: string;
  cards: Card[];
  /**
   * Properties whose bills the user pays — see `houses` in db/schema.ts.
   *
   * Empty on a setup that has never used the feature, and length 1 for the
   * overwhelmingly common single-home case; the UI keys off the count to stay
   * invisible until a second house exists (see core/houses.ts).
   */
  houses: House[];
  categories: Category[];
  subcategories: Subcategory[];
  states: Map<string, SubcategoryState>;
  /** Per-category bulk-transfer status for the current period. */
  categoryStates: Map<string, CategoryState>;
  fundingTotals: Map<string, Minor>;
  /** SUM of child transactions per ongoing subcategory, for the period. */
  transactionTotals: Map<string, Minor>;
  incomes: Income[];
  loans: Loan[];
  currency: string;
  usdRate: number;
  /**
   * Per-bank USD rates, as last fetched — see features/rates.
   *
   * Held in STORE state, not read straight from settings at the point of use.
   * The launch refresh writes them after the dashboard has already mounted, and
   * a screen reading the settings row directly has nothing to tell it the value
   * changed — so the dollar figure beside "money to move" stayed blank until
   * the next cold start. Putting them here makes that arrival a re-render.
   */
  bankRates: BankRate[];
  /** 'system' follows the OS; 'light'/'dark' force a mode. */
  themeMode: 'system' | 'light' | 'dark';
  hapticsEnabled: boolean;
  /**
   * Whether Face ID / Touch ID / passcode is required before the app's contents
   * are shown. Off by default — this is a local-only budgeting app, and locking
   * it should be the user's choice rather than a hurdle everyone inherits.
   */
  appLockEnabled: boolean;
  /**
   * Subscription tier. Local-only for now — there is no billing behind it, so
   * it shapes what the UI offers rather than enforcing anything.
   */
  plan: PlanId;

  /**
   * Parsed-from-SMS transactions awaiting the user's Yes/Edit/No. Held in
   * memory only — a draft is either confirmed into the board or dismissed, so
   * there is nothing to persist. Newest first.
   */
  smsDrafts: SmsDraft[];

  /**
   * The learned merchant → line map, mirrored from the database so
   * `ingestSmsText` can reconcile synchronously. Grows whenever the user
   * resolves a draft (see `confirmDraft`).
   */
  merchantRules: MerchantRule[];

  /**
   * Whether this device exchanges anonymous merchant→category data with the
   * shared catalog.
   *
   * No UI toggles it: syncing is invisible and always on, because the payload
   * carries no personal data — a merchant key and a coarse amount band — and a
   * switch would only invite someone to turn off the thing making their own
   * detection better. Kept as a settings key so it can be disabled without a
   * new build if that ever becomes necessary.
   */
  catalogSyncEnabled: boolean;
  /** ISO timestamp of the last successful sync. Diagnostic only. */
  catalogSyncedAt: string | null;
  /** True while a sync is in flight, so a second cannot start alongside it. */
  catalogSyncing: boolean;

  /**
   * Enabled mini-app ids, exactly as stored — see core/miniApps.ts.
   *
   * Kept as the raw string rather than a parsed set so the store holds one
   * primitive: every reader goes through `enabledMiniApps`, which validates
   * against the registry on the way out.
   */
  miniApps: string;
  setMiniAppEnabled: (id: MiniAppId, on: boolean) => void;

  /** Vehicles for the fuel mini-app. Empty unless it has been used. */
  vehicles: Vehicle[];
  /** Family members tracked by the health add-on — see core/miniApps.ts. */
  healthPeople: HealthPerson[];
  /**
   * Money lent to people — see core/miniApps.ts.
   *
   * Unlike the health add-on's records, these DO live in the store: the
   * dashboard's "Coming up" section needs them on every render to show a debt
   * falling due beside the bills, so reading them per-screen would leave the
   * reminder out of the one place it matters. Both tables are small — a handful
   * of rows each — so the cost is negligible even for the majority who never
   * enable it, where they are simply empty.
   */
  buddyLoans: BuddyLoan[];
  buddyRepayments: BuddyRepayment[];
  addBuddyLoan: (input: Omit<NewBuddyLoan, 'id'>) => BuddyLoan;
  updateBuddyLoan: (id: string, patch: Partial<NewBuddyLoan>) => void;
  deleteBuddyLoan: (id: string) => void;
  /** Settle or write off a debt, stamping the date it was closed. */
  closeBuddyLoan: (id: string, status: 'paid' | 'written_off') => void;
  /** Move a settled or written-off debt back to outstanding. */
  reopenBuddyLoan: (id: string) => void;
  /**
   * Log a part payment. Settles the loan automatically once the repayments
   * cover it, so the user is never left with "LKR 0 left" still outstanding.
   */
  addBuddyRepayment: (input: Omit<NewBuddyRepayment, 'id'>) => void;
  deleteBuddyRepayment: (id: string) => void;
  addVehicle: (input: Omit<NewVehicle, 'id'>) => Vehicle;
  updateVehicle: (id: string, patch: Partial<NewVehicle>) => void;
  deleteVehicle: (id: string) => void;
  addHealthPerson: (input: Omit<NewHealthPerson, 'id'>) => HealthPerson;
  updateHealthPerson: (id: string, patch: Partial<NewHealthPerson>) => void;
  deleteHealthPerson: (id: string) => void;

  initialise: () => Promise<void>;
  /**
   * Reload every slice. The launch/restore path, and the safe default when a
   * mutation's blast radius is not obvious.
   */
  refresh: () => void;
  /**
   * Reload only the board: cards, houses, categories, lines, this period's
   * states and totals, incomes and loans.
   *
   * Most mutations touch nothing else, and the full `refresh` also re-reads a
   * dozen settings keys, the merchant-rule table and the mini-app tables — so
   * calling this instead keeps a bill tap from re-reading data it cannot have
   * changed. Splitting on these lines (rather than per-table) keeps the
   * invariant the store is built on: derived board values are always read back
   * together, so they cannot drift from each other.
   */
  refreshBoard: () => void;
  /** Reload the settings-backed slice, and republish the display currency. */
  refreshSettings: () => void;
  /** Reload the mini-app tables (vehicles, health people). */
  refreshMiniAppData: () => void;
  /** Reload the learned merchant → line map. */
  refreshMerchantRules: () => void;
  setPeriod: (period: string) => void;
  setCurrency: (currency: string) => void;
  setUsdRate: (rate: number) => void;
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setAppLockEnabled: (enabled: boolean) => void;
  setPlan: (plan: PlanId) => void;
  /**
   * Mirror the shared catalog locally, then push this device's corrections.
   * Never throws; returns null when it did not run.
   */
  syncCatalog: () => Promise<{ inserted: number; updated: number; shared: number } | null>;
  /** Offer one resolved draft, with its transaction shape, to the catalog. */
  contributeDraft: (draft: SmsDraft, subcategoryId: string) => Promise<void>;
  /**
   * Create the board line a draft's hint points at, then log the draft against
   * it. Returns the line's id, or null when the hint has no catalog home.
   */
  createLineForDraft: (
    draftId: string,
    overrides?: { amountMinor?: Minor },
  ) => string | null;
  resetAllData: () => Promise<void>;
  seedDemoData: () => void;
  completeOnboarding: () => void;

  /** Toggle a bill between pending and paid. */
  cycleStatus: (subcategoryId: string) => void;
  setStatus: (subcategoryId: string, status: SubcategoryStatus) => void;
  setActual: (subcategoryId: string, actualMinor: Minor | null) => void;
  logTransaction: (
    subcategoryId: string,
    input: {
      status: SubcategoryStatus;
      actualMinor?: Minor | null;
      note?: string | null;
      imageUri?: string | null;
      /** When it happened. Decides the month; defaults to the viewed period. */
      date?: Date;
      /** Which property this payment was for — see core/houses.ts. */
      houseId?: string | null;
    },
  ) => void;
  /** Mark every bill in a category paid or pending at once. */
  markCategory: (categoryId: string, status: SubcategoryStatus) => void;

  /** Set the category's bulk-transfer status (the salary→account move). */
  setCategoryTransfer: (categoryId: string, status: CategoryFundingStatus) => void;
  /** Toggle the category's bulk-transfer status. */
  /**
   * Mark an account's money as moved, or undo it. The dashboard's "money to
   * move" action — see the implementation for why this writes through to the
   * categories the account funds.
   */
  toggleAccountTransfer: (cardId: string) => void;
  /**
   * Mark every category an account funds as transferred — one-way, for the
   * automatic confirmation from a matching bank credit. Returns whether
   * anything actually changed.
   */
  markAccountTransferred: (cardId: string) => boolean;

  fundCategory: (categoryId: string, amountMinor: Minor, note?: string) => void;
  unfundCategory: (categoryId: string) => void;

  reorderCategories: (orderedIds: string[]) => void;
  /**
   * Reorder the bills inside ONE category.
   *
   * Scoped to a single category on purpose — `sortOrder` on a subcategory is
   * only ever compared against its siblings, so the ids passed must all share a
   * parent.
   */
  reorderSubcategories: (categoryId: string, orderedIds: string[]) => void;

  /**
   * `color` is OPTIONAL, not omitted.
   *
   * The user now picks one in the category form (see `categoryColors.ts`), and
   * that choice must survive; the rotating palette below remains for the
   * callers that create a category without a user in the loop — the SMS
   * auto-file path and the learned-category path.
   */
  addCategory: (input: Omit<NewCategory, 'id' | 'color'> & { color?: string }) => Category;
  updateCategory: (id: string, patch: Partial<NewCategory>) => void;
  /**
   * Move every category and expense line funded by one account onto another.
   *
   * For splitting a single account into a foreign "salary lands here" account
   * and a local "bills are paid from here" one. Income is left where it is.
   */
  moveAccountFunding: (fromCardId: string, toCardId: string) => void;
  /**
   * Delete a category and its lines. Refuses — reporting why — when it holds a
   * loan installment, since removing that would leave the debt owed with no
   * bill on the board. Callers should surface `reason` rather than assume the
   * delete happened.
   */
  deleteCategory: (id: string) => { ok: boolean; reason?: string };

  addSubcategory: (input: {
    name: string;
    categoryId: string;
    plannedMinor: Minor;
    type?: 'income' | 'expense';
    frequency?: NewSubcategory['frequency'];
    icon?: string;
    cardId?: string | null;
    dueDay?: number | null;
    loanId?: string | null;
    /** Saving-plan fields; see `subcategories` in schema.ts. */
    planTargetMinor?: Minor | null;
    planDueDate?: Date | null;
    planStartDate?: Date | null;
    /** Whether payments on this line are attributed to a house. */
    houseScoped?: boolean;
    /** Default house for this line's payments — see core/houses.ts. */
    houseId?: string | null;
  }) => Subcategory;
  updateSubcategory: (id: string, patch: Partial<Subcategory>) => void;
  deleteSubcategory: (id: string) => void;
  /** Move a subcategory under a different parent category. */
  changeSubcategoryParent: (id: string, newCategoryId: string) => void;

  /** Add an entry to an ongoing subcategory. Period is derived from `date`. */
  addTransaction: (input: {
    subcategoryId: string;
    name: string;
    amountMinor: Minor;
    date: Date;
    note?: string | null;
    imageUri?: string | null;
    /** Which property this spend was for — see core/houses.ts. */
    houseId?: string | null;
  }) => void;
  updateTransaction: (id: string, patch: Partial<NewTransaction>) => void;
  deleteTransaction: (id: string) => void;

  addCard: (input: Omit<NewCard, 'id' | 'color'>) => Card;
  updateCard: (id: string, patch: Partial<NewCard>) => void;
  deleteCard: (id: string) => void;

  addIncome: (input: Omit<NewIncome, 'id'>) => void;
  updateIncome: (id: string, patch: Partial<NewIncome>) => void;
  deleteIncome: (id: string) => void;

  addLoan: (input: Omit<NewLoan, 'id'>) => void;
  /** Change a loan's terms; the board line's installment is re-derived. */
  updateLoan: (id: string, patch: Partial<NewLoan>) => void;
  deleteLoan: (id: string) => void;

  /**
   * Parse an incoming SMS (from a deep link, share sheet, or paste) into a
   * draft transaction and queue it for confirmation.
   *
   * Returns the new draft's id; `null` when the text was not a recognisable
   * money movement; or the literal `'duplicate'` when an identical raw text is
   * already queued. The three are distinguished because callers report the
   * outcome to the user, and a duplicate is a success (the draft exists) while
   * null is a failure (nothing was understood).
   */
  ingestSmsText: (text: string) => string | 'duplicate' | null;
  /**
   * Import everything the Shortcuts automation has appended to the inbox file,
   * then clear it. Safe to call when the feature is off or the file is missing.
   */
  drainSmsInbox: () => DrainSummary;
  /**
   * Rebuild the review queue from the `sms_inbox` table, re-matching each row
   * against the board as it stands now.
   */
  loadSmsDrafts: () => void;
  /**
   * Retroactively apply the intake rules (noise rejection, own-account transfer
   * pairing) to rows already queued. Returns how many were retired.
   */
  pruneSmsQueue: () => number;
  /**
   * Watch the inbox folder and drain as messages land, for updates while the
   * app is open. Returns an unsubscribe function. Does not replace the
   * launch/foreground drains — iOS fires no events while the app is suspended.
   */
  watchSmsInbox: () => () => void;
  /**
   * Drain the inbox, re-pair the queue and refresh the review list in one call —
   * the whole detection cycle, for a screen that has just come into view.
   *
   * Exists so the dashboard can sync on focus without reproducing the ordering
   * the foreground handler already gets right (drain, then prune across the
   * WHOLE queue, then load). Cheap and idempotent when nothing arrived: the
   * drain's re-entrancy guard absorbs an overlapping call, and a drain that
   * imports nothing does no writes.
   */
  syncSmsNow: () => void;
  /** Messages waiting in the inbox file, without consuming them. */
  smsInboxWaiting: number;
  /** Re-read the waiting count from disk. */
  refreshInboxCount: () => void;
  /**
   * Confirm a queued draft: log it against the chosen bill for the current
   * period (reusing logTransaction), then remove it from the queue. Overrides
   * let the confirm card apply the user's edits before logging. A no-op if the
   * draft has no target subcategory.
   */
  confirmDraft: (
    draftId: string,
    overrides?: {
      subcategoryId?: string;
      amountMinor?: Minor;
      note?: string | null;
      /** Which property this payment was for — see core/houses.ts. */
      houseId?: string | null;
      /**
       * SPLIT this payment across several budget lines.
       *
       * One 5,000 shop is one debit and one SMS, but often not one budget line
       * — 3,000 groceries and 2,000 pet food. When supplied, the parts must sum
       * to the payment (`validateSplit` enforces it at the UI boundary) and the
       * money is recorded as ONE transaction whose allocation lives in
       * `transaction_splits`, so the app still agrees with the bank statement.
       *
       * Absent for the ordinary case, which is unchanged.
       */
      splits?: readonly { subcategoryId: string; amountMinor: Minor; note?: string | null }[];
    },
  ) => void;
  /** Discard a queued draft without logging it. */
  dismissDraft: (draftId: string) => void;

  /** Add a property whose bills are tracked separately. See core/houses.ts. */
  addHouse: (input: Omit<NewHouse, 'id'>) => House;
  updateHouse: (id: string, patch: Partial<NewHouse>) => void;
  /** Mark one house as the user's own home — demotes any previous holder. */
  setPrimaryHouse: (id: string) => void;
  /**
   * Remove a house. Payments that referenced it keep their amounts and simply
   * become unattributed, so deleting a label never changes a month's total.
   */
  deleteHouse: (id: string) => void;
}

/**
 * Icons that mean "nothing better was found", not "the user chose this".
 *
 * Categories created before the icon catalog was filled out were assigned one
 * of these as a fallback, so a board can end up with four different bills all
 * showing a shopping basket — which makes the category grid unscannable, since
 * the icon is the first thing the eye lands on.
 */
const PLACEHOLDER_ICONS = new Set(['basket-outline', 'repeat-outline', 'albums-outline']);


/**
 * Re-suggest icons for categories still sitting on a placeholder.
 *
 * Only placeholders are touched: an icon the user picked deliberately, or one
 * the catalog already matched well, is left exactly as it is. Idempotent — once
 * a category has a real icon it never qualifies again, so this is a no-op on
 * every launch after the first.
 */
function repairGenericCategoryIcons(): void {
  for (const category of categoryRepo.all()) {
    if (!PLACEHOLDER_ICONS.has(category.icon)) continue;
    const suggested = suggestCategoryIcon(category.name);
    // Only replace when the catalog has something genuinely different to say.
    if (suggested && suggested !== category.icon) {
      categoryRepo.update(category.id, { icon: suggested });
    }
  }
}

/**
 * Give tied categories a stable order.
 *
 * `sort_order` defaults to 0 in the DDL, so every category created without an
 * explicit one shares position 0 and their relative order is left to whatever
 * SQLite returns — which can change between launches, making the board appear
 * to reshuffle itself. On the user's device Income, Debt and an auto-created
 * "Bank & fees" were all at 0, so a category holding a 25-rupee bank fee could
 * sort above their salary.
 *
 * Only ties are touched, and existing relative order is preserved (the query is
 * already ordered), so a board the user has deliberately arranged is renumbered
 * to exactly the order it is already displaying. Idempotent: once every
 * category has a distinct index there is nothing left to change.
 */
/**
 * Drop learned rules that send a whole merchant to the Bank charges line.
 *
 * A split fee is named after its parent — "HNB ATM Withdrawal" for both the
 * 10,000 withdrawal and its 30.00 charge — so confirming the fee taught
 * "hnb atm withdrawal -> Bank charges", and every later withdrawal from that
 * merchant inherited it. A learned rule outranks the parser, the kind and the
 * keywords, so the withdrawals sat on the charges line no matter what the
 * parser said about them.
 *
 * `confirmDraft` no longer writes such a rule, but that only stops NEW ones:
 * a device that already learned it stays wrong forever, because nothing
 * revisits a stored rule. This clears the ones already written.
 *
 * Deliberately narrow. Only rules pointing at a bank-charges line, and only
 * where the pattern is not itself fee vocabulary — a rule the user genuinely
 * taught for a merchant that only ever charges fees ("cefts transfer charges")
 * is correct and stays. What is removed is a rule whose pattern names a
 * transaction ("atm withdrawal", "transfer") but resolves to charges.
 */
function repairFeePoisonedMerchantRules(): void {
  const chargeLineIds = new Set(
    subcategoryRepo
      .all()
      .filter((sub) => isBankChargeLine(sub.name))
      .map((sub) => sub.id),
  );
  if (chargeLineIds.size === 0) return;

  for (const rule of merchantRuleRepo.all()) {
    if (rule.source !== 'learned') continue;
    if (!rule.subcategoryId || !chargeLineIds.has(rule.subcategoryId)) continue;
    // A pattern that names a fee belongs on the charges line; leave it.
    if (/\b(?:charge|charges|fee|fees|stamp duty|commission)\b/i.test(rule.pattern)) continue;
    // A pattern that names a movement does not.
    if (!/\b(?:atm|withdrawal|withdraw|transfer|purchase|pos|cash)\b/i.test(rule.pattern)) continue;
    merchantRuleRepo.remove(rule.id);
  }
}

function repairCategorySortOrder(): void {
  const categories = categoryRepo.all();
  if (!hasSiblingTie(categories)) return;

  categoryRepo.reorder(categories.map((category) => category.id));
}

/**
 * The same repair for the BILLS inside each category.
 *
 * `repairCategorySortOrder` fixed the top level and the identical fault one
 * level down went unnoticed, because a tie there is invisible until you try to
 * drag: onboarding assigns board-wide offsets, so "Living" was created holding
 * 4..9, and a bill added afterwards took the sibling count (7) and collided
 * with two rows already at 7. `byCategory` orders by `sort_order` alone, so
 * SQLite returns tied rows in whatever order it likes — the list draws one
 * arrangement, the drag writes indexes computed against it, and the next read
 * disagrees. The bill appears to spring back.
 *
 * Each category is renumbered INDEPENDENTLY and only when it actually holds a
 * tie: positions are compared between siblings and nowhere else, so one
 * category's dense range says nothing about another's, and an untied category
 * must not be rewritten just because its neighbour was. The rows are passed in
 * the order they are already displayed, so this makes the current arrangement
 * explicit without rearranging anything the user chose.
 */
function repairSubcategorySortOrder(): void {
  const categories = categoryRepo.all();

  for (const category of categories) {
    // Already ordered by `sort_order` — i.e. the arrangement being displayed.
    const siblings = subcategoryRepo.byCategory(category.id);
    if (!hasSiblingTie(siblings)) continue;

    subcategoryRepo.reorder(siblings.map((sibling) => sibling.id));
  }
}

/** Round-robin tint so every new item stays visually distinct with zero picker. */
function nextColor(existingCount: number): string {
  return groupColors[existingCount % groupColors.length];
}

/**
 * Whether a drain is in flight.
 *
 * Module-level rather than store state on purpose: it must be readable and
 * writable synchronously within one drain, and putting it in the store would
 * publish a meaningless flag to every subscriber and re-render the board twice
 * per import. See the guard in `drainSmsInbox`.
 */

/**
 * Fingerprints of messages already reported as unreadable this session.
 *
 * A message the parser cannot read is now LEFT IN THE FILE rather than
 * destroyed, so it is re-encountered on every poll tick. This keeps the
 * diagnostics panel showing it once instead of ten identical rows.
 *
 * Module-level and never pruned: it holds at most a handful of short strings
 * for the life of the process, and clearing it on drain would defeat the point.
 */

export const useAppStore = create<AppState>((set, get, api) => ({
  ready: false,
  needsOnboarding: false,
  period: periodKey(new Date()),
  cards: [],
  houses: [],
  categories: [],
  subcategories: [],
  states: new Map(),
  categoryStates: new Map(),
  fundingTotals: new Map(),
  transactionTotals: new Map(),
  incomes: [],
  loans: [],
  currency: 'LKR',
  usdRate: 300,
  bankRates: [],
  themeMode: 'system',
  hapticsEnabled: true,
  appLockEnabled: false,
  // Premium for now: the paid tier is enabled by default until billing exists.
  plan: 'premium',
  smsDrafts: [],
  merchantRules: [],
  catalogSyncEnabled: true,
  catalogSyncedAt: null,
  catalogSyncing: false,
  miniApps: '',
  vehicles: [],
  healthPeople: [],
  buddyLoans: [],
  buddyRepayments: [],

  async initialise() {
    initialiseDatabase();
    // Ship the well-known merchants before the first refresh reads them, so a
    // fresh install already recognises the common chains.
    merchantRuleRepo.seed();
    repairGenericCategoryIcons();
    repairCategorySortOrder();
    repairSubcategorySortOrder();
    repairFeePoisonedMerchantRules();
    get().refresh();
    set({
      ready: true,
      needsOnboarding: settingsRepo.get(SETTINGS_KEYS.onboarded) !== 'true',
    });

    /*
     * Move a pre-rename inbox to the current path first, so anything queued at
     * the old location is picked up by the drain below rather than stranded.
     * A no-op on every device that never used the old path.
     */
    migrateLegacyInbox();

    /*
     * Import anything the Shortcuts automation queued while the app was closed.
     *
     * Synchronous and BEFORE the sync: this is local file work measured in
     * milliseconds, and it is the reason someone opened the app — seeing their
     * transactions waiting is the whole feature.
     */
    /*
     * Put the placeholder houses on a board that has none.
     *
     * Houses were introduced as an onboarding step, which silently excluded
     * everybody who had already finished onboarding: they end up with zero
     * houses, so the picker can never appear and the feature is invisible.
     * Seeding here gives an existing install a working set immediately, and the
     * names are placeholders the user renames (or replaces at re-onboarding).
     *
     * Guarded on the table being EMPTY, so it runs at most once and can never
     * re-add a house the user deliberately deleted.
     */
    if (houseRepo.all().length === 0) {
      for (const house of PLACEHOLDER_HOUSES) get().addHouse(house);
    }

    get().drainSmsInbox();

    /*
     * Retire queued rows the CURRENT rules would never have queued.
     *
     * Runs after the drain so this launch's arrivals are pruned alongside
     * whatever was already waiting — the two halves of a transfer are commonly
     * split across sessions, and pairing needs both in the same pass.
     *
     * Idempotent, so the usual case is a no-op scan of a short list.
     */
    get().pruneSmsQueue();

    /*
     * Show anything still awaiting review from previous sessions.
     *
     * This is what the durable queue buys: before, a draft the user did not act
     * on before closing the app was gone, because the file had already been
     * cleared and the draft only ever lived in memory.
     */
    get().loadSmsDrafts();

    /*
     * React to messages that arrive while the app is open. Never unsubscribed:
     * it lives exactly as long as the store, which lives as long as the app.
     */
    get().watchSmsInbox();

    /*
     * Refresh the catalog at launch, deliberately UN-AWAITED.
     *
     * The app is already fully usable at this point — detection reads the
     * catalog SQLite already holds — so a first launch on a dead connection
     * must not sit behind a download. Data lands whenever it lands.
     */
    void get().syncCatalog();

    /*
     * ...and again whenever the app returns to the foreground.
     *
     * Without this, someone who opened the app on a train keeps whatever catalog
     * they had until they fully relaunch. Foregrounding is a good proxy for
     * "might have signal now", and `syncCatalog` is cheap when nothing changed —
     * the cursor means an up-to-date device fetches an empty page.
     *
     * Never unsubscribed: it lives exactly as long as the store, which lives as
     * long as the app.
     */
    /*
     * Catalog only. The SMS inbox has its own foreground handler inside
     * `watchSmsInbox`, so draining here as well would import twice on every
     * return to the app.
     */
    onNetworkRestored(() => {
      void get().syncCatalog();
    });
  },

  refreshBoard() {
    const { period } = get();
    set({
      cards: cardRepo.all(),
      houses: houseRepo.all(),
      categories: categoryRepo.all(),
      subcategories: subcategoryRepo.all(),
      states: stateRepo.byPeriod(period),
      categoryStates: categoryStateRepo.byPeriod(period),
      fundingTotals: fundingRepo.totalsByPeriod(period),
      transactionTotals: transactionRepo.totalsByPeriod(period),
      incomes: incomeRepo.all(),
      loans: loanRepo.all(),
    });
  },

  refreshSettings() {
    const currency = settingsRepo.get(SETTINGS_KEYS.currency) ?? 'LKR';
    // Publish to shared/lib/money so the ~100 `formatMoney` call sites that
    // render an amount without knowing about settings pick up the user's
    // choice. Done on every settings refresh (not just setCurrency) so a fresh
    // launch is correct too.
    setDisplayCurrency(currency);

    set({
      currency,
      usdRate: settingsRepo.getNumber(SETTINGS_KEYS.usdRate, 300),
      bankRates: readCachedRates(settingsRepo.get(SETTINGS_KEYS.bankRates)),
      themeMode:
        (settingsRepo.get(SETTINGS_KEYS.themeMode) as 'system' | 'light' | 'dark') ?? 'system',
      hapticsEnabled: settingsRepo.get(SETTINGS_KEYS.haptics) !== 'false',
      // Opt-in, so an absent key means off — the opposite default to haptics.
      appLockEnabled: settingsRepo.get(SETTINGS_KEYS.appLock) === 'true',
      // Defaults to premium while there is no billing to buy it with.
      plan: (settingsRepo.get(SETTINGS_KEYS.plan) as PlanId) ?? 'premium',
      // Opt-out, so an absent key means on — the opposite default to app lock.
      catalogSyncEnabled: settingsRepo.get(SETTINGS_KEYS.catalogSync) !== 'false',
      catalogSyncedAt: settingsRepo.get(SETTINGS_KEYS.catalogSyncedAt) ?? null,
      miniApps: settingsRepo.get(SETTINGS_KEYS.miniApps) ?? '',
    });
  },

  refreshMiniAppData() {
    set({
      vehicles: vehicleRepo.all(),
      buddyLoans: buddyLoanRepo.all(),
      buddyRepayments: buddyRepaymentRepo.all(),
      /*
       * People only — never their records.
       *
       * The store holds what every health screen needs to render a header (who
       * exists), while medicines, doses, visits and readings are read straight
       * from the repositories by the screen that shows them, exactly as the
       * fuel app does with fill-ups. Keeping a family's medical history in the
       * global store would load it on every launch for the majority who never
       * enable this — and would keep it in memory long after the screen closed.
       */
      healthPeople: healthPersonRepo.all(),
    });
  },

  addBuddyLoan(input) {
    const created = buddyLoanRepo.create(input);
    get().refreshMiniAppData();
    return created;
  },

  updateBuddyLoan(id, patch) {
    buddyLoanRepo.update(id, patch);
    get().refreshMiniAppData();
  },

  deleteBuddyLoan(id) {
    /*
     * The photo goes with the record.
     *
     * Repayment rows cascade in SQL, but their images do not — nothing else
     * references these files, so without this every deleted loan leaves its
     * slip photos behind in Documents forever.
     */
    const loan = buddyLoanRepo.byId(id);
    if (loan?.imageUri) deletePersistedImage(loan.imageUri);
    for (const repayment of buddyRepaymentRepo.byLoan(id)) {
      if (repayment.imageUri) deletePersistedImage(repayment.imageUri);
    }

    buddyLoanRepo.remove(id);
    get().refreshMiniAppData();
  },

  closeBuddyLoan(id, status) {
    buddyLoanRepo.close(id, status);
    get().refreshMiniAppData();
  },

  reopenBuddyLoan(id) {
    buddyLoanRepo.reopen(id);
    get().refreshMiniAppData();
  },

  addBuddyRepayment(input) {
    buddyRepaymentRepo.create(input);

    /*
     * Settle the loan the moment the repayments cover it.
     *
     * Read back from the repository rather than from the store, because the
     * store's copy is one refresh behind the row just written — using it would
     * miss the very payment that completes the debt, and leave a record showing
     * nothing left to pay that still counts as outstanding.
     */
    const loan = buddyLoanRepo.byId(input.loanId);
    if (loan && loan.status === 'outstanding') {
      const repayments = buddyRepaymentRepo.byLoan(input.loanId);
      if (isFullyRepaid(loan, repayments.map(toRepaymentLike))) {
        // Dated by the payment that closed it, not by "now" — a repayment
        // logged days later must not stamp today as the settlement date.
        buddyLoanRepo.close(input.loanId, 'paid', input.paidOn);
      }
    }

    get().refreshMiniAppData();
  },

  deleteBuddyRepayment(id) {
    const repayment = get().buddyRepayments.find((r) => r.id === id);
    if (repayment?.imageUri) deletePersistedImage(repayment.imageUri);

    /*
     * Removing a payment can UNSETTLE a loan.
     *
     * The balance is derived, so deleting the payment that completed a debt
     * leaves money owed again — and a record marked paid with an outstanding
     * balance is exactly the kind of quiet inconsistency this add-on exists to
     * avoid. Reopened only when it was closed as PAID: a write-off is the
     * user's decision and is not reversed by bookkeeping.
     */
    if (repayment) {
      const loan = buddyLoanRepo.byId(repayment.loanId);
      buddyRepaymentRepo.remove(id);

      if (loan?.status === 'paid') {
        const left = buddyRepaymentRepo.byLoan(repayment.loanId);
        if (!isFullyRepaid(loan, left.map(toRepaymentLike))) {
          buddyLoanRepo.reopen(repayment.loanId);
        }
      }
    }

    get().refreshMiniAppData();
  },

  refreshMerchantRules() {
    set({ merchantRules: merchantRuleRepo.all() });
  },

  refresh() {
    get().refreshBoard();
    get().refreshSettings();
    get().refreshMerchantRules();
    get().refreshMiniAppData();
  },

  setPeriod(period) {
    set({ period });
    get().refreshBoard();
  },

  setMiniAppEnabled(id, on) {
    const next = toggleMiniApp(get().miniApps, id, on);
    settingsRepo.set(SETTINGS_KEYS.miniApps, next);

    /*
     * Seed a sample history the first time the fuel app is switched on.
     *
     * Tank-to-tank consumption needs two full tanks before it can report
     * anything, so an empty tracker shows "—" everywhere and reads as broken
     * rather than as new. `seedFuelSample` is a no-op once any vehicle exists,
     * so this cannot duplicate on a re-toggle.
     */
    if (on && id === 'fuel') seedFuelSample();
    /*
     * Same reasoning as fuel: every health screen is built around history — a
     * timeline, an adherence percentage, a trend chart — and all three are
     * blank with no data, which reads as broken rather than as new. The sample
     * is one clearly-labelled person; deleting them cascades it all away.
     */
    if (on && id === 'health') seedHealthSample();

    set({ miniApps: next });
    get().refreshSettings();
  },

  addVehicle(input) {
    const created = vehicleRepo.create({ ...input, sortOrder: get().vehicles.length });
    get().refreshMiniAppData();
    return created;
  },

  updateVehicle(id, patch) {
    vehicleRepo.update(id, patch);
    get().refreshMiniAppData();
  },

  /** Cascades to the vehicle's fill-ups and services — see the schema. */
  deleteVehicle(id) {
    vehicleRepo.remove(id);
    get().refreshMiniAppData();
  },

  addHealthPerson(input) {
    /*
     * `isSelf` is NOT decided here any more.
     *
     * It used to be set silently on the first person added, which guessed at
     * something the user was never asked and could not see. "Myself" is now one
     * of the relations they pick from, and `healthPersonRepo.create` derives
     * the flag from that — so the answer lives in one place, chosen rather than
     * inferred.
     */
    const created = healthPersonRepo.create({
      ...input,
      sortOrder: get().healthPeople.length,
    });
    get().refreshMiniAppData();
    return created;
  },

  updateHealthPerson(id, patch) {
    healthPersonRepo.update(id, patch);
    get().refreshMiniAppData();
  },

  /** Cascades to every medicine, dose, visit, document and reading. */
  deleteHealthPerson(id) {
    healthPersonRepo.remove(id);
    get().refreshMiniAppData();
  },

  setCurrency(currency) {
    settingsRepo.set(SETTINGS_KEYS.currency, currency);
    get().refreshSettings();
  },

  setUsdRate(rate) {
    settingsRepo.set(SETTINGS_KEYS.usdRate, String(rate));
    get().refreshSettings();
  },

  setThemeMode(mode) {
    settingsRepo.set(SETTINGS_KEYS.themeMode, mode);
    get().refreshSettings();
  },

  setHapticsEnabled(enabled) {
    settingsRepo.set(SETTINGS_KEYS.haptics, enabled ? 'true' : 'false');
    get().refreshSettings();
  },

  setAppLockEnabled(enabled) {
    settingsRepo.set(SETTINGS_KEYS.appLock, enabled ? 'true' : 'false');
    get().refreshSettings();
  },

  setPlan(plan) {
    settingsRepo.set(SETTINGS_KEYS.plan, plan);
    get().refreshSettings();
  },

  /**
   * Mirror the shared catalog into SQLite, then contribute this device's
   * corrections back.
   *
   * This is the ONLY network call detection depends on, and nothing waits for
   * it. Once the catalog is local, every incoming SMS is categorised on-device
   * with no round trip — which is the point, because an SMS arrives at a fuel
   * pump or in a supermarket queue, exactly where signal is worst.
   *
   * At ~30 bytes per merchant the whole catalog is tens of KB even at a hundred
   * thousand users, and subsequent pulls are incremental, so mirroring costs far
   * less than one API call per transaction would.
   *
   * Resolves to null when nothing happened (no API configured, sharing off,
   * offline, or a run already in flight) and never rejects.
   */
  async syncCatalog() {
    if (!isCatalogConfigured()) return null;
    if (!get().catalogSyncEnabled) return null;
    // A second run while one is in flight would merge against stale local rules
    // and contribute the same corrections twice.
    if (get().catalogSyncing) return null;

    // A fetch with no connectivity fails harmlessly in milliseconds, so there is
    // nothing to gain by checking first — and `onNetworkRestored` in
    // `initialise` retries on the next foreground, which is how a launch on a
    // train still ends up with a catalog.
    set({ catalogSyncing: true });
    try {
      let cursor = settingsRepo.get(SETTINGS_KEYS.catalogCursor) ?? null;
      let inserted = 0;
      let updated = 0;

      /*
       * Page until the server says it is done. The cursor is persisted after
       * each page, so an interrupted sync resumes where it stopped rather than
       * refetching the catalog from scratch.
       *
       * The page cap bounds a first sync against a large catalog — the rest
       * arrives on the next launch, and detection is already better meanwhile.
       */
      for (let page = 0; page < 20; page++) {
        const result = await pullRules(cursor);
        if (result.rules.length === 0) break;

        // Re-read local rules each page: applying page N changes what page N+1
        // should do, and merging both against one stale snapshot would re-insert
        // merchants the previous page just added.
        const plan = planCatalogMerge(result.rules, merchantRuleRepo.all());
        const counts = merchantRuleRepo.applyCatalog(plan);
        inserted += counts.inserted;
        updated += counts.updated;

        if (result.nextSince) {
          cursor = result.nextSince;
          settingsRepo.set(SETTINGS_KEYS.catalogCursor, cursor);
        }
        if (!result.hasMore) break;
      }

      /*
       * Contribute after pulling, so a correction the user made is voted on even
       * if the catalog already held a different answer for that merchant.
       *
       * Only the rule is available here — the transaction shape that produced it
       * was not stored — so `observationsFrom` fills direction and band with
       * defaults. The real shape rides along on future corrections, which is why
       * `confirmDraft` contributes directly rather than waiting for this.
       */
      const observations = observationsFrom(merchantRuleRepo.all().map((rule) => ({ rule })));

      let shared = 0;
      if (observations.length > 0) {
        const deviceId = await getDeviceId();
        // No keystore means no stable identity; skip rather than vote with a
        // per-launch id, which would let one device stuff the ballot.
        if (deviceId) shared = await pushObservations(deviceId, observations);
      }

      const syncedAt = new Date().toISOString();
      settingsRepo.set(SETTINGS_KEYS.catalogSyncedAt, syncedAt);

      // Only refresh when the catalog actually changed — an unconditional
      // refresh on every launch re-renders the whole board for nothing.
      if (inserted > 0 || updated > 0) get().refreshSettings();
      else set({ catalogSyncedAt: syncedAt });

      return { inserted, updated, shared };
    } catch {
      // Deliberately swallowed: see the doc comment above.
      return null;
    } finally {
      set({ catalogSyncing: false });
    }
  },

  /**
   * Offer one resolved draft to the shared catalog, with the transaction's
   * shape attached — the direction and a COARSE amount band, never the amount.
   *
   * Done at confirm time rather than only at sync because this is the one moment
   * the shape is known: the rules table stores the mapping, not the message that
   * produced it. This is what lets the catalog learn that a ~2k DIALOG debit is
   * a phone bill while a ~90k one is a handset.
   *
   * Silent by design — the user confirmed a transaction, not a network request.
   */
  async contributeDraft(draft, subcategoryId) {
    if (!isCatalogConfigured() || !get().catalogSyncEnabled) return;

    // The rule just written carries the hint the user effectively endorsed by
    // picking this line.
    const rule = get().merchantRules.find(
      (candidate) =>
        candidate.subcategoryId === subcategoryId &&
        candidate.pattern === merchantKey(draft.parsed.merchant),
    );
    if (!rule?.hint) return;

    const observations = observationsFrom([
      {
        rule,
        // A bill notice is not money leaving yet, but for ranking it behaves
        // like a debit — both describe an expense at this merchant.
        direction: draft.parsed.direction === 'credit' ? 'credit' : 'debit',
        amountMinor: draft.amountMinor,
      },
    ]);
    if (observations.length === 0) return;

    const deviceId = await getDeviceId();
    if (deviceId) await pushObservations(deviceId, observations);
  },

  createLineForDraft(draftId, overrides) {
    const draft = get().smsDrafts.find((candidate) => candidate.id === draftId);
    if (!draft) return null;

    /*
     * Fall back to the message-wide read when the narrow hint is null.
     *
     * `draft.hint` only names the ten buckets the shared catalog votes on, so a
     * hospital, pharmacy or restaurant produced no proposal and the user was
     * offered nothing — even though the merchant name said exactly what it was.
     * `guesses` is the wider read (see core/merchantSignals.ts); taking its
     * best entry means "create the line for me" works for those too.
     */
    const category = draft.hint ?? draft.guesses[0]?.category ?? null;

    const proposal = proposalForHint(category);
    if (!proposal) return null;

    /*
     * Prefer what the user already has, in two steps, so this can never grow a
     * duplicate board:
     *
     *   1. an existing line that serves this hint — by catalog name or by the
     *      same keyword match detection scores with, so a hand-named "CEB bill"
     *      is reused rather than joined by a second "Electricity";
     *   2. an existing group with the catalog's name, so a new line lands in the
     *      user's own "Housing" instead of creating a second one.
     */
    const existing = findLineForHint(category, get().subcategories, get().categories);
    if (existing) {
      get().confirmDraft(draftId, {
        subcategoryId: existing.id,
        amountMinor: overrides?.amountMinor,
      });
      return existing.id;
    }

    const group =
      findGroupForProposal(proposal, get().categories) ??
      get().addCategory({
        name: proposal.category.name,
        icon: proposal.category.icon,
        defaultFrequency: 'monthly',
      });

    /*
     * Planned amount stays 0: the user has not planned this line, and seeding it
     * from a single SMS would invent a budget from one observation. The amount
     * lands as the logged actual, so the line shows as ongoing spending —
     * the honest reading of "this happened and you had not budgeted for it".
     */
    const created = get().addSubcategory({
      name: proposal.subcategory.name,
      type: proposal.type,
      categoryId: group.id,
      plannedMinor: 0,
      frequency: proposal.subcategory.frequency ?? 'monthly',
      dueDay: proposal.subcategory.dueDay ?? null,
      icon: proposal.subcategory.icon,
      /*
       * A line created from an SMS inherits the same house scoping an
       * onboarding-created one gets, so a CEB bill that first arrives by
       * message behaves identically to one the user picked from the catalog.
       * Without this, the house picker would appear on some electricity lines
       * and not others depending purely on how they came into existence.
       */
      houseScoped: isHouseScopedHint(draft.hint),
      houseId: get().houses.find((house) => house.isPrimary)?.id ?? null,
    });

    get().confirmDraft(draftId, {
      subcategoryId: created.id,
      amountMinor: overrides?.amountMinor,
    });

    return created.id;
  },

  /**
   * "Clear all data" in settings. Wipes every table, cancels any local
   * notifications scheduled for categories that no longer exist, and marks
   * the app as already-onboarded so it comes back empty rather than
   * replaying the onboarding wizard.
   */
  async resetAllData() {
    await cancelAllReminders().catch((error) =>
      console.warn('Reminder cancel skipped:', error),
    );
    resetDatabase();
    // Send the user back through onboarding. Marking the wiped app as already
    // onboarded dropped them onto an empty dashboard with no route back to the
    // setup flow — the same state a fresh install starts from, minus the help.
    settingsRepo.set(SETTINGS_KEYS.onboarded, 'false');
    set({ period: periodKey(new Date()), needsOnboarding: true });
    // A wipe clears every table, so this is one of the few places that really
    // does need all of it — a board-only reload would leave stale settings,
    // merchant rules and mini-app rows pointing at deleted data.
    get().refresh();
  },

  /** Dev-only convenience: reloads the genericized sample template. */
  seedDemoData() {
    seedSampleTemplate();
    get().refresh();
  },

  completeOnboarding() {
    settingsRepo.set(SETTINGS_KEYS.onboarded, 'true');
    set({ needsOnboarding: false });
  },

  cycleStatus(subcategoryId) {
    const { period, states } = get();
    // Repo already normalises to pending/paid, so the cast is a formality.
    const current = (states.get(subcategoryId)?.status as SubcategoryStatus) ?? 'pending';
    stateRepo.setStatus(subcategoryId, period, nextStatus(current));
    get().refreshBoard();
  },

  setStatus(subcategoryId, status) {
    stateRepo.setStatus(subcategoryId, get().period, status);
    get().refreshBoard();
  },

  setActual(subcategoryId, actualMinor) {
    stateRepo.setActual(subcategoryId, get().period, actualMinor);
    get().refreshBoard();
  },

  logTransaction(subcategoryId, input) {
    // A caller that supplies a date is stating which month this belongs to, so
    // it wins over the month currently on screen — otherwise back-dating an
    // entry would silently file it under whichever period was being viewed.
    const period = input.date ? periodKey(input.date) : get().period;
    stateRepo.logTransaction(subcategoryId, period, input);
    get().refreshBoard();
  },

  markCategory(categoryId, status) {
    const { period, subcategories } = get();
    const ids = subcategories.filter((s) => s.categoryId === categoryId).map((s) => s.id);
    stateRepo.setStatusForSubcategories(ids, period, status);
    get().refreshBoard();
  },

  setCategoryTransfer(categoryId, status) {
    categoryStateRepo.setStatus(categoryId, get().period, status);
    get().refreshBoard();
  },

  /**
   * Mark every category funded from an account as transferred, or undo that.
   *
   * This is the real-world action: the salary lands in one place, and the user
   * moves a lump sum to each account according to what it is FOR — savings,
   * living costs, vehicle-and-health. The thing they need to remember is "have
   * I moved money to the vehicle account yet?", which is a fact about the
   * ACCOUNT, not about any one category inside it.
   *
   * Written through to `category_states` rather than stored on the card,
   * deliberately. An account's purpose IS its set of categories here, so a
   * separate per-account record would be a second place to store one fact —
   * and the two could then disagree, leaving an account marked moved while the
   * categories it funds still read as pending in every total on the board.
   * Writing through keeps one source of truth and leaves every existing
   * calculation working untouched.
   *
   * Resolves per LEAF, matching `selectAccountTransfers`: a subcategory can
   * override its category's card, so "categories funded from this account"
   * means any category with at least one line drawing on it.
   */
  /**
   * Mark an account's funding as moved, from the bank's own confirmation.
   *
   * The dashboard says "move LKR 158,347 onto Spending"; the user does it; the
   * bank texts to say it arrived. Without this they must still come back and
   * tick the row by hand, restating something already confirmed.
   *
   * Deliberately one-way: it only ever marks TRANSFERRED, never back to
   * pending. `toggleAccountTransfer` flips, which is right for a tap but wrong
   * here — a second matching credit must not silently un-fund a month.
   *
   * Returns whether anything changed, so the caller can log an auto-mark
   * distinctly from a message that merely happened to be internal.
   */
  markAccountTransferred(cardId) {
    const { period, categories, subcategories, categoryStates } = get();

    const fundedCategoryIds = categories
      .filter((category) =>
        subcategories.some(
          (sub) =>
            sub.categoryId === category.id &&
            sub.type === 'expense' &&
            resolveCardId(sub.cardId, category.cardId) === cardId,
        ),
      )
      .map((category) => category.id)
      // Already transferred categories are skipped rather than rewritten, so
      // the return value reports a real change.
      .filter((id) => (categoryStates.get(id)?.status ?? 'pending') !== 'transferred');

    if (fundedCategoryIds.length === 0) return false;

    for (const id of fundedCategoryIds) {
      categoryStateRepo.setStatus(id, period, 'transferred');
    }

    get().refreshBoard();
    return true;
  },

  toggleAccountTransfer(cardId) {
    const { period, categories, subcategories, categoryStates } = get();

    const fundedCategoryIds = new Set(
      categories
        .filter((category) =>
          subcategories.some(
            (sub) =>
              sub.categoryId === category.id &&
              sub.type === 'expense' &&
              resolveCardId(sub.cardId, category.cardId) === cardId,
          ),
        )
        .map((category) => category.id),
    );

    if (fundedCategoryIds.size === 0) return;

    /*
     * One tap sets them all the same way, rather than flipping each in place.
     *
     * The account reads as done only when everything it funds is transferred,
     * so a half-transferred account must resolve to "mark the rest" — toggling
     * each category independently would leave it in the same mixed state and
     * the tap would appear to do nothing.
     */
    const allTransferred = [...fundedCategoryIds].every(
      (id) => (categoryStates.get(id)?.status ?? 'pending') === 'transferred',
    );
    const next = allTransferred ? 'pending' : 'transferred';

    for (const id of fundedCategoryIds) {
      categoryStateRepo.setStatus(id, period, next);
    }

    get().refreshBoard();
  },

  fundCategory(categoryId, amountMinor, note) {
    if (amountMinor <= 0) return;
    const { period, categories } = get();
    const category = categories.find((c) => c.id === categoryId);

    fundingRepo.create({
      categoryId,
      cardId: category?.cardId ?? null,
      period,
      amountMinor,
      date: new Date(),
      note: note ?? null,
    });

    // Recording the bulk money onto the account *is* the category transfer;
    // it does not touch any individual bill's paid/pending state.
    categoryStateRepo.setStatus(categoryId, period, 'transferred');

    get().refreshBoard();
  },

  unfundCategory(categoryId) {
    const { period } = get();
    fundingRepo.clearForCategory(categoryId, period);
    categoryStateRepo.setStatus(categoryId, period, 'pending');
    get().refreshBoard();
  },

  reorderCategories(orderedIds) {
    categoryRepo.reorder(orderedIds);
    get().refreshBoard();
  },

  reorderSubcategories(categoryId, orderedIds) {
    /*
     * The passed ids are filtered against the category's ACTUAL children rather
     * than trusted.
     *
     * The list screen holds a filtered view (a search, or "unpaid only"), so a
     * drag there produces an order covering only the visible rows. Writing that
     * straight through would renumber three of a category's eight bills to
     * 0,1,2 and collide them with the five it never saw. Reconciling here keeps
     * the hidden lines in their existing relative order behind the ones the
     * user actually arranged.
     */
    const siblings = get().subcategories.filter((sub) => sub.categoryId === categoryId);
    const moved = orderedIds.filter((id) => siblings.some((sub) => sub.id === id));
    const untouched = siblings.filter((sub) => !moved.includes(sub.id)).map((sub) => sub.id);

    subcategoryRepo.reorder([...moved, ...untouched]);
    get().refreshBoard();
  },

  addCategory(input) {
    const created = categoryRepo.create({
      ...input,
      // An explicit choice wins; the rotation is the fallback for the paths
      // that create a category with no user present to pick one.
      color: input.color ?? nextColor(get().categories.length),
      /*
       * Default to the END of the board, not the top.
       *
       * `sort_order` has no DB default beyond 0, so any caller that omits it —
       * the SMS auto-file path and the learned-category path both do — lands a
       * new category at position 0, tied with Income and Debt. That is how a
       * "Bank & fees" category created for a 25-rupee charge ended up sitting
       * above the user's salary, which reads as though the app decided bank
       * fees were the most important thing on their board.
       *
       * An explicit `sortOrder` from the caller (onboarding passes one) still
       * wins, so deliberate ordering is untouched.
       */
      sortOrder: input.sortOrder ?? get().categories.length,
    });
    get().refreshBoard();
    return created;
  },
  updateCategory(id, patch) {
    categoryRepo.update(id, patch);
    get().refreshBoard();
  },

  /**
   * Repoint every category and line funded by one account at another.
   *
   * The case this exists for: someone holds a foreign-currency account that
   * RECEIVES their salary and a local one their bills are actually paid from.
   * Setting the first to USD restates its funding total in dollars, which is
   * correct and almost never intended — the fix is to move the bills, and
   * doing that one at a time across a real board is 25 trips through a picker.
   *
   * Both levels are moved, and they are not the same thing. A CATEGORY names
   * the account its bills inherit; a LINE may override that. Moving only
   * categories would leave every overriding line behind on the old account,
   * which is exactly the half-migration that makes the totals stop adding up.
   *
   * Income is deliberately untouched. A salary LANDS in the foreign account —
   * that is the whole point of holding it — so sweeping income lines across
   * would undo the arrangement this is meant to support.
   */
  moveAccountFunding(fromCardId, toCardId) {
    if (fromCardId === toCardId) return;

    const { categories, subcategories } = get();

    for (const category of categories) {
      if (category.cardId === fromCardId) categoryRepo.update(category.id, { cardId: toCardId });
    }

    for (const sub of subcategories) {
      // Only explicit overrides. A line with a null `cardId` inherits from its
      // category, which has just been moved — rewriting it would convert an
      // inheritance into an override and quietly pin it to this account.
      if (sub.type === 'income') continue;
      if (sub.cardId === fromCardId) subcategoryRepo.update(sub.id, { cardId: toCardId });
    }

    get().refreshBoard();
  },
  deleteCategory(id) {
    /*
     * Deleting a category cascades to its lines. For the shared Debt category
     * that would silently destroy every loan's board line while leaving the
     * loans themselves behind — a bill vanishing from the plan with the debt
     * still owed. Loans are removed from the Loans screen, which cleans up both.
     *
     * The refusal is REPORTED rather than silent. A bare `return` here read to
     * the user as "delete is broken": the confirm alert accepted their Delete,
     * the screen popped, and the category was still on the board with nothing
     * said. Callers now get the reason and can show it.
     */
    const holdsLoan = get().subcategories.some(
      (sub) => sub.categoryId === id && sub.loanId,
    );
    if (holdsLoan) {
      return {
        ok: false,
        reason:
          'This category holds a loan installment. Delete the loan from the Loans tab — that removes its bill here too.',
      };
    }

    categoryRepo.remove(id);
    get().refreshBoard();
    return { ok: true };
  },

  addSubcategory(input) {
    const siblings = get().subcategories.filter((s) => s.categoryId === input.categoryId);
    const category = get().categories.find((c) => c.id === input.categoryId);
    const created = subcategoryRepo.create({
      name: input.name,
      type: input.type ?? 'expense',
      categoryId: input.categoryId,
      plannedMinor: input.plannedMinor,
      // Fall back to the category's default cadence, not a blanket "monthly".
      frequency: input.frequency ?? category?.defaultFrequency ?? 'monthly',
      dueDay: input.dueDay ?? null,
      icon: input.icon ?? 'pricetag-outline',
      color: category?.color ?? nextColor(siblings.length),
      cardId: input.cardId ?? null,
      loanId: input.loanId ?? null,
      planTargetMinor: input.planTargetMinor ?? null,
      planDueDate: input.planDueDate ?? null,
      planStartDate: input.planStartDate ?? null,
      houseScoped: input.houseScoped ?? false,
      // Only meaningful on a house-scoped line; stored regardless so turning
      // scoping on later does not lose a default the caller already knew.
      houseId: input.houseId ?? null,
      /*
       * The END of the sibling list, derived from the highest position in use
       * rather than from the sibling COUNT.
       *
       * A count is only the same number when the existing bills occupy a dense
       * `0..n-1` range, and onboarding does not produce one — it walks its
       * catalog handing out board-wide offsets, so "Living" was created holding
       * 4..9. Eight rows then made the next line 7, tying with the two already
       * there. Every read of `sort_order` orders by that column alone, so a tie
       * is undefined order: the list draws one arrangement, a drag writes
       * indexes against it, and the next read comes back different — which is
       * why reordering a bill appeared to do nothing.
       */
      sortOrder: nextSiblingSortOrder(siblings),
    });
    get().refreshBoard();
    return created;
  },
  updateSubcategory(id, patch) {
    // Saving plans belong only to yearly lines (product rule). If this edit
    // moves the line off yearly, wipe the plan fields so no stale sinking-fund
    // data lingers on a monthly/one-time/ongoing line.
    const current = get().subcategories.find((s) => s.id === id);
    const nextFrequency = patch.frequency ?? current?.frequency;
    const clearPlan =
      nextFrequency !== undefined && !supportsSavingPlan(nextFrequency)
        ? { planTargetMinor: null, planDueDate: null, planStartDate: null }
        : {};

    /*
     * Switching an ONGOING line to a dated bill collapses its entries into one.
     *
     * An ongoing line accumulates many charges; a dated bill holds exactly one. Left
     * alone, a "Groceries" line with five entries became a bill claiming those
     * five sum to a single payment — and, since any entry settles a bill, one
     * that silently marked itself paid.
     *
     * The entries are merged rather than dropped: the money was really spent,
     * and deleting a month of records because a picker changed would be the
     * worst possible reading of the gesture. The survivor keeps the total and
     * says where it came from.
     */
    const becomingPlanned =
      patch.frequency !== undefined &&
      !isOngoing(patch.frequency) &&
      current != null &&
      isOngoing(current.frequency);

    if (becomingPlanned) {
      const period = get().period;
      const entries = transactionRepo.bySubcategoryPeriod(id, period);
      if (entries.length > 0) {
        /*
         * Sum the entries into the month's typed actual, then drop them.
         *
         * A dated bill shows one amount field and no entry list, so entries
         * left in place would still count toward the total (see `billActual`)
         * while being invisible and uneditable on the screen. Their sum is
         * carried into the field that IS shown, with what they were kept as a
         * note so the detail is not simply lost.
         */
        const total = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
        const detail = entries
          .map((entry) => `${entry.name}: ${entry.amountMinor / 100}`)
          .join(', ');
        for (const entry of entries) transactionRepo.remove(entry.id);
        stateRepo.logTransaction(id, period, {
          status: 'paid',
          actualMinor: total,
          note:
            entries.length > 1
              ? `Combined from ${entries.length} entries — ${detail}`
              : (entries[0].note ?? null),
        });
      }
    }

    /*
     * Switching a BILL to an ongoing line carries its actual across as an entry.
     *
     * A paid bill often has no transaction at all — the paid toggle and a
     * confirmed SMS both write a per-month state row instead. An ongoing line reads
     * only its entries, so without this the line would flip to "nothing spent"
     * and lose a payment the user had already recorded.
     */
    const becomingBudget =
      patch.frequency !== undefined &&
      isOngoing(patch.frequency) &&
      current != null &&
      !isOngoing(current.frequency);

    if (becomingBudget) {
      const period = get().period;
      const actual = get().states.get(id)?.actualMinor ?? null;
      const alreadyLogged = transactionRepo.bySubcategoryPeriod(id, period).length > 0;
      if (actual != null && actual > 0 && !alreadyLogged) {
        transactionRepo.create({
          subcategoryId: id,
          period,
          name: current!.name,
          amountMinor: actual,
          date: new Date(),
          note: 'Carried over when this line became ongoing',
          houseId: null,
        });
      }
    }

    subcategoryRepo.update(id, { ...patch, ...clearPlan });
    get().refreshBoard();
  },
  deleteSubcategory(id) {
    subcategoryRepo.remove(id);
    get().refreshBoard();
  },

  /** Move a subcategory under a different parent category, appending it to the
   * end of the target's list so ordering stays sensible. */
  changeSubcategoryParent(id, newCategoryId) {
    const siblings = get().subcategories.filter((s) => s.categoryId === newCategoryId);
    // Past the target's highest position, not its count — see `addSubcategory`.
    subcategoryRepo.update(id, {
      categoryId: newCategoryId,
      sortOrder: nextSiblingSortOrder(siblings),
    });
    get().refreshBoard();
  },

  addTransaction(input) {
    const period = periodKey(input.date);

    /*
     * A DATED line holds ONE entry a month — it is a single bill paid once
     * (rent, the electricity bill, a subscription), so a second entry for the
     * same month is a correction of the first, not another payment.
     *
     * Replacing rather than refusing is deliberate: the second entry usually
     * arrives from Smart Detect confirming the very payment the user had
     * already typed in, and rejecting it would leave the accurate bank figure
     * on the floor while keeping the hand-typed guess.
     *
     * An ongoing line accumulates instead, which is the whole point of it.
     */
    const line = get().subcategories.find((s) => s.id === input.subcategoryId);
    if (line && !isOngoing(line.frequency)) {
      for (const existing of transactionRepo.bySubcategoryPeriod(input.subcategoryId, period)) {
        transactionRepo.remove(existing.id);
      }
    }

    transactionRepo.create({
      subcategoryId: input.subcategoryId,
      period,
      name: input.name,
      amountMinor: input.amountMinor,
      date: input.date,
      note: input.note ?? null,
      imageUri: input.imageUri ?? null,
      houseId: input.houseId ?? null,
    });
    get().refreshBoard();
  },
  updateTransaction(id, patch) {
    // Keep the period in sync if the date moved to another month.
    const next = patch.date ? { ...patch, period: periodKey(patch.date) } : patch;
    transactionRepo.update(id, next);
    get().refreshBoard();
  },
  deleteTransaction(id) {
    transactionRepo.remove(id);
    get().refreshBoard();
  },

  addCard(input) {
    const created = cardRepo.create({ ...input, color: nextColor(get().cards.length) });
    get().refreshBoard();
    return created;
  },
  updateCard(id, patch) {
    cardRepo.update(id, patch);
    get().refreshBoard();
  },
  deleteCard(id) {
    cardRepo.remove(id);
    get().refreshBoard();
  },

  addIncome(input) {
    incomeRepo.create(input);
    get().refreshBoard();
  },
  updateIncome(id, patch) {
    incomeRepo.update(id, patch);
    get().refreshBoard();
  },
  deleteIncome(id) {
    incomeRepo.remove(id);
    get().refreshBoard();
  },

  /**
   * Record a loan and put its installment on the board as a line under the one
   * shared "Debt" category.
   *
   * Every loan is the same kind of commitment, so they belong together as
   * sibling lines rather than a category each — which is also what the ratio
   * block already assumed (it treats "contains a loan-linked line" as debt).
   * Creating the line here means a loan can never again exist without appearing
   * in the plan, which is how a loan could previously be invisible in PLANNED.
   */
  addLoan(input) {
    const loan = loanRepo.create(input);

    // The installment is derived, never stored, so the line always agrees with
    // the loan's terms (see core/amortization.ts).
    const { installmentMinor } = buildSchedule({
      principalMinor: loan.principalMinor,
      annualRatePct: loan.annualRatePct,
      termMonths: loan.termMonths,
      interestMethod: loan.interestMethod,
    });

    /*
     * Icons match the catalog's Debt category (see categoryCatalog.ts): a
     * banknote for the group, and the loan's own kind for each line. They are
     * repeated rather than read from the catalog because this row is created by
     * a migration path too — see `consolidateDebtCategories` in db/client.ts,
     * which must agree with this.
     */
    const debtCategory =
      get().categories.find((category) => category.id === DEBT_CATEGORY_ID) ??
      categoryRepo.create({
        id: DEBT_CATEGORY_ID,
        name: 'Debt',
        color: '#B7791F',
        icon: 'cash-outline',
        dueDay: 1,
      });

    subcategoryRepo.create({
      name: loan.name,
      categoryId: debtCategory.id,
      plannedMinor: installmentMinor,
      frequency: 'monthly',
      // Per KIND, so a lease and a mortgage are told apart at a glance rather
      // than every debt line wearing the same mark as its parent.
      icon: LOAN_LINE_ICON[loan.kind] ?? 'cash-outline',
      /*
       * The LENDER'S colour, so the line on the board and the card on the Loans
       * tab are recognisably the same debt. Three loans under one Debt category
       * otherwise render as three identical amber rows, and the user has to
       * read each name to tell which bank they are looking at.
       */
      color: loan.bankId ? resolveBrand({ bankId: loan.bankId }).color : debtCategory.color,
      loanId: loan.id,
    });

    get().refreshBoard();
  },
  /**
   * Change a loan's terms, and re-derive the board line that follows from them.
   *
   * The installment is never stored on the loan — it is computed from principal,
   * rate and term — so editing any of those has to rewrite the subcategory's
   * `plannedMinor` too. Skipping that would leave the plan quietly funding the
   * OLD installment, which is the kind of wrong figure nobody notices until the
   * money is short.
   */
  updateLoan(id, patch) {
    const updated = loanRepo.update(id, patch);
    if (!updated) return;

    const { installmentMinor } = buildSchedule({
      principalMinor: updated.principalMinor,
      annualRatePct: updated.annualRatePct,
      termMonths: updated.termMonths,
      interestMethod: updated.interestMethod,
    });

    // Renaming the loan renames its line as well, so the two never disagree on
    // the board.
    for (const sub of get().subcategories.filter((s) => s.loanId === id)) {
      subcategoryRepo.update(sub.id, {
        name: updated.name,
        plannedMinor: installmentMinor,
        // Moving the loan to a different lender re-colours its line too, or the
        // board would keep showing the old bank's hue.
        ...(updated.bankId ? { color: resolveBrand({ bankId: updated.bankId }).color } : null),
        icon: LOAN_LINE_ICON[updated.kind] ?? 'cash-outline',
      });
    }

    get().refreshBoard();
  },

  /** Remove a loan and the board line it created, so no orphan bill remains. */
  deleteLoan(id) {
    for (const sub of get().subcategories.filter((s) => s.loanId === id)) {
      subcategoryRepo.remove(sub.id);
    }
    loanRepo.remove(id);
    get().refreshBoard();
  },

  ...createSmsSlice(set, get, api),


  addHouse(input) {
    const created = houseRepo.create({
      ...input,
      // First house is the user's own home unless they said otherwise: with one
      // house every payment belongs to it, and having no primary would leave
      // `defaultHouseId` with nothing to fall back on.
      isPrimary: input.isPrimary ?? get().houses.length === 0,
      sortOrder: input.sortOrder ?? get().houses.length,
    });

    /*
     * Mark existing per-property lines as house-scoped, once a SECOND house
     * makes the distinction meaningful.
     *
     * A board created before this feature has every line at `house_scoped = 0`,
     * because scoping is set at creation from a catalog id or an SMS hint that
     * older lines never had. Without this, a user could add their parents'
     * house, go to tag the electricity bill, and find no picker anywhere — the
     * feature would look broken while working exactly as written.
     *
     * Runs on the second house rather than the first because that is the moment
     * the question becomes answerable, and only touches lines still at the
     * default — a line the user has deliberately unscoped stays unscoped.
     */
    const houses = houseRepo.all();
    /*
     * Backfill once the SECOND house exists — the moment "which house?" becomes
     * a real question. `>= 2` rather than `=== 2` because houses can also be
     * seeded in a batch (see `ensureHousesSeeded`), where the count jumps past
     * two and an equality check would silently skip the backfill entirely.
     */
    if (houses.length >= 2) {
      for (const sub of get().subcategories) {
        if (sub.houseScoped) continue;

        const category = get().categories.find((c) => c.id === sub.categoryId);
        if (!isHouseScopedName(`${sub.name} ${category?.name ?? ''}`)) continue;

        subcategoryRepo.update(sub.id, {
          houseScoped: true,
          // Default to the user's own home; the picker is what changes it.
          houseId: houses.find((house) => house.isPrimary)?.id ?? null,
        });
      }
    }

    get().refreshBoard();
    return created;
  },

  updateHouse(id, patch) {
    houseRepo.update(id, patch);
    get().refreshBoard();
  },

  setPrimaryHouse(id) {
    houseRepo.setPrimary(id);
    get().refreshBoard();
  },

  deleteHouse(id) {
    houseRepo.remove(id);

    /*
     * Promote another house when the primary one is removed.
     *
     * Without this, deleting the home leaves every house unflagged and
     * `defaultHouseId` falls through to null — so new payments silently stop
     * being attributed to anything on a setup that still has houses in it.
     */
    const remaining = houseRepo.all();
    if (remaining.length > 0 && !remaining.some((house) => house.isPrimary)) {
      houseRepo.setPrimary(remaining[0].id);
    }

    get().refreshBoard();
  },

}));

// --------------------------------------------------------------- subscribing
//
// `useAppStore()` with no argument subscribes a component to EVERY field, so
// any mutation anywhere re-renders it. These hooks narrow that.

/**
 * The store's actions, with a stable identity.
 *
 * Actions are created once inside `create()` and never reassigned, so this
 * object's contents never change — subscribing to it therefore never triggers
 * a re-render. Use it wherever a component only dispatches and does not read:
 *
 *   const { addTransaction } = useAppActions();
 *
 * Prefer this over `useAppStore()` for handlers and effects; it also makes the
 * dependency honest, since an action in a `useEffect` dep list is now stable
 * rather than a fresh reference each render.
 */
/**
 * The function-valued half of AppState. Derived rather than hand-listed, so
 * adding an action to the interface adds it here automatically.
 */
export type AppActions = ActionsOf<AppState>;

/** See selectActions.ts for why this is cached and how it is tested. */
const selectActions = createActionsSelector<AppState>();

export function useAppActions(): AppActions {
  return useAppStore(selectActions);
}

/**
 * Subscribe to one derived slice.
 *
 * Equivalent to `useAppStore(selector)`, named so call sites read as an intent
 * ("I need the card views") rather than a store access, and so the selector
 * form is the obvious default in a file that already imports this.
 */
export function useAppSelector<T>(selector: (state: AppState) => T): T {
  return useAppStore(selector);
}

/**
 * Derived views live in selectors.ts; re-exported so the ~47 files that read
 * `selectCardViews` and friends from this module keep working, and so there is
 * one obvious import for "the store and what you compute from it".
 */
export * from './selectors';

/**
 * Re-exported from the SMS slice, which owns it. `export ... from` forwards the
 * live binding, so a reader here sees each drain's update rather than the value
 * captured at import time — which a `const` copy would freeze at null.
 */
export { lastDrainReport } from './smsSlice';
