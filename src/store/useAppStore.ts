import { create } from 'zustand';
import { buildSchedule, paymentsElapsed, remainingBalance } from '../core/amortization';
import { setDisplayCurrency, sumMinor, type Minor } from '../core/money';
import type { PlanId } from '../core/plans';
import {
  calculateRatios,
  daysUntil,
  dueDateFor,
  isFlexibleDueDay,
  isSpend,
  monthlyAmount,
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
} from '../core/planning';
import { suggestCategoryIcon } from '../data/categoryIcons';
import { groupColors } from '../theme';
import { parseSms, type ParsedSms } from '../core/smsParser';
import { reconcileSms, type SmsDraft } from '../core/smsReconcile';
import { merchantKey, planRuleUpsert, type MerchantRule } from '../core/merchantRules';
import { observationsFrom, planCatalogMerge } from '../core/catalogSync';
import {
  findGroupForProposal,
  findLineForHint,
  proposalForHint,
} from '../core/hintCatalog';
import type { CategoryHint } from '../core/smsCategoryHints';
import { logSmsIntake } from '../core/smsIntakeLog';
import { isCatalogConfigured, pullRules, pushObservations } from '../services/catalogApi';
import { getDeviceId } from '../services/deviceId';
import { onForeground, onNetworkRestored } from '../services/network';
import {
  cancelReversals,
  EMPTY_SUMMARY,
  fingerprintMessage,
  type DrainSummary,
} from '../core/smsInbox';
import {
  countWaiting,
  drainInbox,
  ensureInboxExists,
  migrateLegacyInbox,
  watchInbox,
} from '../services/smsInboxFile';
import { DEBT_CATEGORY_ID, initialiseDatabase, resetDatabase } from '../db/client';
import {
  cardRepo,
  categoryRepo,
  categoryStateRepo,
  fundingRepo,
  incomeRepo,
  loanRepo,
  merchantRuleRepo,
  settingsRepo,
  smsInboxRepo,
  stateRepo,
  subcategoryRepo,
  transactionRepo,
  SETTINGS_KEYS,
} from '../db/repositories';
import { seedSampleTemplate } from '../db/seed';
import {
  cancelAllReminders,
  notifyDraftsImported,
} from '../services/notifications';
import { isUnplanned, supportsSavingPlan } from '../db/schema';
import type {
  Card,
  Category,
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
  categories: Category[];
  subcategories: Subcategory[];
  states: Map<string, SubcategoryState>;
  /** Per-category bulk-transfer status for the current period. */
  categoryStates: Map<string, CategoryState>;
  fundingTotals: Map<string, Minor>;
  /** SUM of child transactions per unplanned subcategory, for the period. */
  transactionTotals: Map<string, Minor>;
  incomes: Income[];
  loans: Loan[];
  currency: string;
  usdRate: number;
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

  initialise: () => Promise<void>;
  refresh: () => void;
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

  fundCategory: (categoryId: string, amountMinor: Minor, note?: string) => void;
  unfundCategory: (categoryId: string) => void;

  reorderCategories: (orderedIds: string[]) => void;

  addCategory: (input: Omit<NewCategory, 'id' | 'color'>) => Category;
  updateCategory: (id: string, patch: Partial<NewCategory>) => void;
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
  }) => Subcategory;
  updateSubcategory: (id: string, patch: Partial<Subcategory>) => void;
  deleteSubcategory: (id: string) => void;
  /** Move a subcategory under a different parent category. */
  changeSubcategoryParent: (id: string, newCategoryId: string) => void;

  /** Add an entry to an unplanned subcategory. Period is derived from `date`. */
  addTransaction: (input: {
    subcategoryId: string;
    name: string;
    amountMinor: Minor;
    date: Date;
    note?: string | null;
    imageUri?: string | null;
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
   * Watch the inbox folder and drain as messages land, for updates while the
   * app is open. Returns an unsubscribe function. Does not replace the
   * launch/foreground drains — iOS fires no events while the app is suspended.
   */
  watchSmsInbox: () => () => void;
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
    overrides?: { subcategoryId?: string; amountMinor?: Minor; note?: string | null },
  ) => void;
  /** Discard a queued draft without logging it. */
  dismissDraft: (draftId: string) => void;
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
let draining = false;

/**
 * What the most recent drain actually did, for the diagnostics alert.
 *
 * The drain has several branches that all end with "file cleared, nothing on
 * screen", and from the outside they are indistinguishable — which is why this
 * feature has been so hard to pin down. Recording the counts plus the pending
 * row total makes the branch that fired obvious: a message that was `queued` but
 * left zero pending rows is a UI/publish problem, one that came back
 * `duplicate` is a fingerprint already in the table, and one counted `ignored`
 * is a parser gap.
 *
 * Module-level and overwritten each drain: it is a live debugging aid, not
 * history.
 */
export let lastDrainReport: {
  at: number;
  messages: number;
  queued: number;
  duplicates: number;
  ignored: number;
  pendingRows: number;
  draftsInStore: number;
} | null = null;

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
const loggedUnreadable = new Set<string>();

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  needsOnboarding: false,
  period: periodKey(new Date()),
  cards: [],
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

  async initialise() {
    initialiseDatabase();
    // Ship the well-known merchants before the first refresh reads them, so a
    // fresh install already recognises the common chains.
    merchantRuleRepo.seed();
    repairGenericCategoryIcons();
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
    get().drainSmsInbox();

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

  refresh() {
    const { period } = get();
    const currency = settingsRepo.get(SETTINGS_KEYS.currency) ?? 'LKR';
    // Publish to core/money so the ~100 `formatMoney` call sites that render an
    // amount without knowing about settings pick up the user's choice. Done on
    // every refresh (not just setCurrency) so a fresh launch is correct too.
    setDisplayCurrency(currency);

    set({
      cards: cardRepo.all(),
      categories: categoryRepo.all(),
      subcategories: subcategoryRepo.all(),
      states: stateRepo.byPeriod(period),
      categoryStates: categoryStateRepo.byPeriod(period),
      fundingTotals: fundingRepo.totalsByPeriod(period),
      transactionTotals: transactionRepo.totalsByPeriod(period),
      incomes: incomeRepo.all(),
      loans: loanRepo.all(),
      merchantRules: merchantRuleRepo.all(),
      currency,
      usdRate: settingsRepo.getNumber(SETTINGS_KEYS.usdRate, 300),
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
    });
  },

  setPeriod(period) {
    set({ period });
    get().refresh();
  },

  setCurrency(currency) {
    settingsRepo.set(SETTINGS_KEYS.currency, currency);
    get().refresh();
  },

  setUsdRate(rate) {
    settingsRepo.set(SETTINGS_KEYS.usdRate, String(rate));
    get().refresh();
  },

  setThemeMode(mode) {
    settingsRepo.set(SETTINGS_KEYS.themeMode, mode);
    get().refresh();
  },

  setHapticsEnabled(enabled) {
    settingsRepo.set(SETTINGS_KEYS.haptics, enabled ? 'true' : 'false');
    get().refresh();
  },

  setAppLockEnabled(enabled) {
    settingsRepo.set(SETTINGS_KEYS.appLock, enabled ? 'true' : 'false');
    get().refresh();
  },

  setPlan(plan) {
    settingsRepo.set(SETTINGS_KEYS.plan, plan);
    get().refresh();
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
      if (inserted > 0 || updated > 0) get().refresh();
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

    const proposal = proposalForHint(draft.hint);
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
    const existing = findLineForHint(draft.hint, get().subcategories, get().categories);
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
     * lands as the logged actual, so the line shows as unplanned spending —
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
    get().refresh();
  },

  setStatus(subcategoryId, status) {
    stateRepo.setStatus(subcategoryId, get().period, status);
    get().refresh();
  },

  setActual(subcategoryId, actualMinor) {
    stateRepo.setActual(subcategoryId, get().period, actualMinor);
    get().refresh();
  },

  logTransaction(subcategoryId, input) {
    // A caller that supplies a date is stating which month this belongs to, so
    // it wins over the month currently on screen — otherwise back-dating an
    // entry would silently file it under whichever period was being viewed.
    const period = input.date ? periodKey(input.date) : get().period;
    stateRepo.logTransaction(subcategoryId, period, input);
    get().refresh();
  },

  markCategory(categoryId, status) {
    const { period, subcategories } = get();
    const ids = subcategories.filter((s) => s.categoryId === categoryId).map((s) => s.id);
    stateRepo.setStatusForSubcategories(ids, period, status);
    get().refresh();
  },

  setCategoryTransfer(categoryId, status) {
    categoryStateRepo.setStatus(categoryId, get().period, status);
    get().refresh();
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

    get().refresh();
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

    get().refresh();
  },

  unfundCategory(categoryId) {
    const { period } = get();
    fundingRepo.clearForCategory(categoryId, period);
    categoryStateRepo.setStatus(categoryId, period, 'pending');
    get().refresh();
  },

  reorderCategories(orderedIds) {
    categoryRepo.reorder(orderedIds);
    get().refresh();
  },

  addCategory(input) {
    const created = categoryRepo.create({ ...input, color: nextColor(get().categories.length) });
    get().refresh();
    return created;
  },
  updateCategory(id, patch) {
    categoryRepo.update(id, patch);
    get().refresh();
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
    get().refresh();
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
      sortOrder: siblings.length,
    });
    get().refresh();
    return created;
  },
  updateSubcategory(id, patch) {
    // Saving plans belong only to yearly lines (product rule). If this edit
    // moves the line off yearly, wipe the plan fields so no stale sinking-fund
    // data lingers on a monthly/one-time/unplanned line.
    const nextFrequency = patch.frequency ?? get().subcategories.find((s) => s.id === id)?.frequency;
    const clearPlan =
      nextFrequency !== undefined && !supportsSavingPlan(nextFrequency)
        ? { planTargetMinor: null, planDueDate: null, planStartDate: null }
        : {};
    subcategoryRepo.update(id, { ...patch, ...clearPlan });
    get().refresh();
  },
  deleteSubcategory(id) {
    subcategoryRepo.remove(id);
    get().refresh();
  },

  /** Move a subcategory under a different parent category, appending it to the
   * end of the target's list so ordering stays sensible. */
  changeSubcategoryParent(id, newCategoryId) {
    const siblings = get().subcategories.filter((s) => s.categoryId === newCategoryId);
    subcategoryRepo.update(id, { categoryId: newCategoryId, sortOrder: siblings.length });
    get().refresh();
  },

  addTransaction(input) {
    transactionRepo.create({
      subcategoryId: input.subcategoryId,
      period: periodKey(input.date),
      name: input.name,
      amountMinor: input.amountMinor,
      date: input.date,
      note: input.note ?? null,
      imageUri: input.imageUri ?? null,
    });
    get().refresh();
  },
  updateTransaction(id, patch) {
    // Keep the period in sync if the date moved to another month.
    const next = patch.date ? { ...patch, period: periodKey(patch.date) } : patch;
    transactionRepo.update(id, next);
    get().refresh();
  },
  deleteTransaction(id) {
    transactionRepo.remove(id);
    get().refresh();
  },

  addCard(input) {
    const created = cardRepo.create({ ...input, color: nextColor(get().cards.length) });
    get().refresh();
    return created;
  },
  updateCard(id, patch) {
    cardRepo.update(id, patch);
    get().refresh();
  },
  deleteCard(id) {
    cardRepo.remove(id);
    get().refresh();
  },

  addIncome(input) {
    incomeRepo.create(input);
    get().refresh();
  },
  updateIncome(id, patch) {
    incomeRepo.update(id, patch);
    get().refresh();
  },
  deleteIncome(id) {
    incomeRepo.remove(id);
    get().refresh();
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
    });

    const debtCategory =
      get().categories.find((category) => category.id === DEBT_CATEGORY_ID) ??
      categoryRepo.create({
        id: DEBT_CATEGORY_ID,
        name: 'Debt',
        color: '#B7791F',
        icon: 'trending-down-outline',
        dueDay: 1,
      });

    subcategoryRepo.create({
      name: loan.name,
      categoryId: debtCategory.id,
      plannedMinor: installmentMinor,
      frequency: 'monthly',
      icon: 'trending-down-outline',
      loanId: loan.id,
    });

    get().refresh();
  },
  /** Remove a loan and the board line it created, so no orphan bill remains. */
  deleteLoan(id) {
    for (const sub of get().subcategories.filter((s) => s.loanId === id)) {
      subcategoryRepo.remove(sub.id);
    }
    loanRepo.remove(id);
    get().refresh();
  },

  ingestSmsText(text) {
    const parsed = parseSms(text);
    if (!parsed) return null;

    /*
     * Persist BEFORE building the draft.
     *
     * The queue is a table now, so the duplicate check is the unique index on
     * `fingerprint` rather than a scan of what happens to be in memory. That
     * closes the hole the in-memory check left open: the same alert arriving
     * after a restart used to sail through, because the previous draft had
     * evaporated with the process.
     */
    const fingerprint = fingerprintMessage(parsed.raw);

    const inserted = smsInboxRepo.add({
      raw: parsed.raw,
      fingerprint,
      direction: parsed.direction,
      kind: parsed.kind,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      merchant: parsed.merchant,
      account: parsed.account,
      occurredOn: parsed.date,
      occurredAt: parsed.time,
    });

    /*
     * A repeat of a message the user already RESOLVED comes back for review.
     *
     * `add` returns false for two very different situations, and collapsing
     * them is what made a re-sent message disappear for good: the row may still
     * be pending (already on screen — nothing to do), or it may have been
     * confirmed/dismissed earlier, in which case the fingerprint blocks the
     * insert forever and the message is consumed from the file with nothing to
     * show for it. Reopening the resolved row puts it back in the queue.
     *
     * This is also what makes testing possible at all: sending yourself the same
     * alert twice used to work exactly once per install.
     */
    if (!inserted && !smsInboxRepo.isPending(fingerprint)) {
      smsInboxRepo.reopen(fingerprint);
      get().loadSmsDrafts();
      return get().smsDrafts.find((draft) => draft.parsed.raw === parsed.raw)?.id ?? null;
    }

    // 'duplicate' rather than null: the caller logs the outcome, and reporting
    // this as a parse failure made a successful deep link show an error beside
    // its own success (both the layout listener and the sms/index route ingest
    // a cold-start link, so the second delivery always lands here).
    if (!inserted) return 'duplicate';

    // Rebuild from the table so the rows the user sees are exactly the rows
    // that are stored — no path where the two can drift apart.
    get().loadSmsDrafts();

    return get().smsDrafts.find((draft) => draft.parsed.raw === parsed.raw)?.id ?? null;
  },

  /**
   * Rebuild `smsDrafts` from the `sms_inbox` table.
   *
   * Matching runs here rather than at insert time because it depends on the
   * board — cards, bills, learned merchant rules — all of which change while a
   * message sits in the queue. Re-reconciling on load means a draft queued
   * yesterday is matched against the board as it is NOW, so a bill created in
   * between is picked up instead of the draft being stuck with a stale guess.
   */
  loadSmsDrafts() {
    const { subcategories, categories, cards, merchantRules, currency, usdRate } = get();

    const drafts = smsInboxRepo.pending().map((row) =>
      reconcileSms(
        {
          direction: (row.direction ?? 'debit') as ParsedSms['direction'],
          kind: (row.kind ?? 'other') as ParsedSms['kind'],
          amountMinor: row.amountMinor ?? 0,
          currency: row.currency,
          merchant: row.merchant ?? '',
          account: row.account ?? '',
          date: row.occurredOn,
          time: row.occurredAt,
          raw: row.raw,
        },
        { subcategories, categories, cards },
        // The ROW's id, so confirming a draft can resolve the row it came from.
        row.id,
        merchantRules,
        // A foreign-currency alert (an inward USD salary, say) is converted to
        // the user's currency before it is matched or logged — the board is
        // entirely in one currency, so an unconverted figure would match nothing
        // and record a salary as pocket change.
        { currency, usdRate },
      ),
    );

    /*
     * Already newest-transaction-first — see `smsInboxRepo.pending`.
     *
     * This used to `.reverse()`, because the query returned arrival order. It
     * now sorts by when the money moved, so reversing here would put the OLDEST
     * transaction on top.
     */
    const next = drafts;

    /*
     * Publish only when the QUEUE changed, not on every call.
     *
     * This runs on every foreground and after every drain tick, and each call
     * builds a fresh array — so an unconditional `set` hands every subscriber a
     * new reference and re-renders the board even when nothing moved. Comparing
     * the row ids is enough: they are the `sms_inbox` primary keys, so a
     * different set of pending rows always yields a different list.
     */
    const current = get().smsDrafts;
    const unchanged =
      current.length === next.length &&
      current.every((draft, i) => {
        const fresh = next[i];
        // Ids alone are not enough: a draft is re-matched against the board on
        // every load, so creating a bill changes what an UNCHANGED row resolves
        // to. Comparing the match as well means a new bill shows up on a
        // waiting draft immediately, rather than after the queue next changes.
        return (
          draft.id === fresh.id &&
          draft.subcategoryId === fresh.subcategoryId &&
          draft.confidence === fresh.confidence
        );
      });

    /*
     * Publishes `smsDrafts` ONLY.
     *
     * `smsInboxWaiting` counts what is still sitting in the FILE, which is the
     * drain's business, not this function's. Zeroing it here used to be
     * harmless because nothing called this after a drain had set it — now the
     * drain does, and clearing it would erase the "left for next time" count of
     * a capped import the instant it was recorded, so the user would be told
     * nothing is waiting while 30 messages still were.
     */
    if (unchanged) return;

    set({ smsDrafts: next });
  },

  smsInboxWaiting: 0,

  refreshInboxCount() {
    set({ smsInboxWaiting: countWaiting() });
  },

  /**
   * Drain the Shortcuts inbox file into the `sms_inbox` table.
   *
   * Rows are written BEFORE the file is cleared (see `drainInbox`), so an
   * interrupted import replays rather than losing messages — the unique
   * fingerprint index makes the replay a no-op.
   *
   * Each message goes through the same `ingestSmsText` a deep link uses, so a
   * file-imported transaction is indistinguishable from a tapped one — same
   * parser, same detection, same duplicate guard.
   */
  drainSmsInbox() {
    let queued = 0;
    let duplicates = 0;
    let ignored = 0;

    /*
     * Re-entrancy guard.
     *
     * The drain writes to the very folder the watcher is watching (it clears the
     * file, then recreates it), so every drain schedules another watcher event.
     * Without this the second drain finds an empty file and stops, but it still
     * costs a wasted read and a redundant re-render on every single import.
     */
    if (draining) return { ...EMPTY_SUMMARY };
    draining = true;

    try {
      const drained = drainInbox((messages) => {
        /*
         * Cancel reversal pairs across the WHOLE batch before anything is
         * stored.
         *
         * Pairing has to happen here rather than inside `ingestSmsText`, which
         * only ever sees one message: a reversal and the charge it undoes are
         * two separate SMS, and recognising the pair needs both in hand. Doing
         * it before the insert also means neither row is ever written, so the
         * user never sees a spend and a refund flicker into the queue and then
         * have to be tidied away.
         */
        const parsed = messages.map((raw) => ({ raw, sms: parseSms(raw) }));
        const movements = parsed.filter(
          (entry): entry is { raw: string; sms: ParsedSms } => entry.sms !== null,
        );

        /*
         * Messages the parser did not understand are counted here, since they
         * never reach `ingestSmsText` below.
         *
         * Each one is also LOGGED. This path used to be completely silent: a
         * message the parser rejected was counted, the file was cleared, and the
         * text was gone with no record of it anywhere — which is precisely the
         * "the file emptied but nothing showed up" report, and it was impossible
         * to diagnose because the evidence destroyed itself. The deep-link path
         * has always logged this; the file path never did.
         */
        const unreadable = parsed.filter((entry) => entry.sms === null).map((entry) => entry.raw);

        /*
         * Log each unreadable message ONCE, not on every tick.
         *
         * These now stay in the file (see the return below), and the watcher
         * re-drains every couple of seconds — so an unlogged guard here would
         * refill the ten-entry diagnostics panel with the same message and push
         * out the very history the user needs to debug it.
         */
        for (const raw of unreadable) {
          const key = fingerprintMessage(raw);
          if (loggedUnreadable.has(key)) continue;
          loggedUnreadable.add(key);
          logSmsIntake('parser-rejected', raw);
        }

        ignored += unreadable.length;

        const surviving = cancelReversals(movements.map((entry) => entry.sms));
        const keep = new Set(surviving);

        for (const entry of movements) {
          // A charge cancelled by its reversal — and the reversal itself — are
          // both dropped: no row, no draft, nothing for the user to dismiss.
          if (!keep.has(entry.sms)) continue;

          const result = get().ingestSmsText(entry.raw);
          if (result === 'duplicate') duplicates++;
          else if (result === null) ignored++;
          else queued++;
        }

        /*
         * Hand back what could not be stored, so the file keeps it.
         *
         * Only the unreadable ones. A duplicate is already in the table and a
         * reversal pair was cancelled deliberately — both are genuinely
         * consumed, and returning them would make the file never empty.
         */
        return unreadable;
      });

      if (!drained.ok || drained.messages.length === 0) {
        /*
         * Write only on a real change.
         *
         * This path runs on every poll tick (see `watchInbox`), and the file is
         * empty almost every time. An unconditional `set` would publish a new
         * state object every couple of seconds forever, waking every subscriber
         * to re-render an unchanged board.
         */
        if (get().smsInboxWaiting !== 0) set({ smsInboxWaiting: 0 });
        return { ...EMPTY_SUMMARY, deferred: drained.deferred };
      }

      /*
       * Put the empty file back.
       *
       * `drainInbox` deletes it when it takes everything, and Shortcuts' "Append
       * to File" needs an existing target — without this, a working setup would
       * break silently after its very first import, with the automation
       * reporting success and nothing ever arriving.
       *
       * Only when the user has actually set this up, so a device that has never
       * enabled it does not grow a stray file in its Documents folder.
       */
      if (settingsRepo.get(SETTINGS_KEYS.smsInboxEnabled) === 'true') {
        ensureInboxExists();
      }

      set({ smsInboxWaiting: drained.deferred });

      // Recorded BEFORE the reload below, then updated after, so the two views
      // of the queue can be compared — see `lastDrainReport`.
      lastDrainReport = {
        at: Date.now(),
        messages: drained.messages.length,
        queued,
        duplicates,
        ignored,
        pendingRows: smsInboxRepo.pendingCount(),
        draftsInStore: 0,
      };

      /*
       * Republish the queue from the table before returning.
       *
       * `ingestSmsText` calls `loadSmsDrafts` per message, so the common path is
       * already on screen — but only when something was INSERTED. A batch that
       * is entirely duplicates, or whose messages all cancelled as reversal
       * pairs, inserts nothing and would leave the dashboard showing a stale
       * list while the file it came from has just been cleared. Loading here
       * makes "the file emptied" and "the UI updated" the same event on every
       * path, which is the guarantee this feature actually needs.
       *
       * Cheap to repeat: `loadSmsDrafts` publishes only when the queue really
       * changed, so the usual case is a no-op comparison.
       */
      get().loadSmsDrafts();

      // How many drafts the UI actually ended up with. A non-zero `queued` with
      // zero here is the publish bug; matching numbers point at the renderer.
      if (lastDrainReport) lastDrainReport.draftsInStore = get().smsDrafts.length;

      /*
       * Announce the import.
       *
       * Un-awaited: the drafts are already stored and on screen, and a
       * notification must never delay that or fail the import if permission was
       * declined. Only fires when rows were genuinely queued — see
       * `notifyDraftsImported`.
       */
      void notifyDraftsImported(queued);

      return { queued, duplicates, ignored, deferred: drained.deferred };
    } finally {
      draining = false;
    }
  },

  /**
   * Start reacting to messages that arrive while the app is open.
   *
   * Complements, and cannot replace, the launch/foreground drains: iOS suspends
   * the app in the background, so a message appended while it is closed fires no
   * event and is picked up on the next foreground instead.
   *
   * Returns an unsubscribe function.
   */
  watchSmsInbox() {
    const stopWatching = watchInbox(() => {
      // The guard inside `drainSmsInbox` absorbs the events caused by the
      // drain's own writes to this folder.
      const summary = get().drainSmsInbox();
      if (summary.queued > 0) get().refresh();
    });

    /*
     * Drain on every return to the foreground.
     *
     * This is the path that actually matters, and it is separate from the
     * watcher on purpose. Messages arrive while the app is suspended — no timer
     * runs, no filesystem event is delivered — so foregrounding is the first
     * instant anything can see them. Without this, a message that landed while
     * the app sat in the switcher would wait for a full relaunch.
     *
     * `loadSmsDrafts` runs even when the drain imports nothing, so rows left
     * pending from an earlier session are on screen rather than waiting for the
     * queue to change.
     */
    const stopForeground = onForeground(() => {
      const summary = get().drainSmsInbox();
      get().loadSmsDrafts();
      if (summary.queued > 0) get().refresh();
    });

    return () => {
      stopWatching();
      stopForeground();
    };
  },

  confirmDraft(draftId, overrides) {
    const { smsDrafts, period } = get();
    const draft = smsDrafts.find((d) => d.id === draftId);
    if (!draft) return;

    const subcategoryId = overrides?.subcategoryId ?? draft.subcategoryId;
    // Without a target bill there is nothing to mark paid; the confirm card
    // must supply one before this is reachable.
    if (!subcategoryId) return;

    const amountMinor = overrides?.amountMinor ?? draft.amountMinor;
    const target = get().subcategories.find((s) => s.id === subcategoryId);

    if (target && target.frequency === 'unplanned') {
      // An unplanned line accumulates individual entries, so a confirmed SMS
      // becomes one transaction rather than the month's single "actual".
      transactionRepo.create({
        subcategoryId,
        period: draft.parsed.date ? draft.parsed.date.slice(0, 7) : period,
        name: draft.parsed.merchant || 'SMS transaction',
        amountMinor,
        date: draft.parsed.date ? new Date(draft.parsed.date) : new Date(),
        note: overrides?.note ?? draft.parsed.raw,
      });
    } else {
      stateRepo.logTransaction(subcategoryId, period, {
        status: 'paid',
        actualMinor: amountMinor,
        note: overrides?.note ?? `From SMS: ${draft.parsed.raw}`,
      });
    }

    // Learn from the resolution. Whether the user accepted our guess or picked
    // a different line, the merchant now has a confirmed mapping — so the next
    // message from the same shop is recognised outright. Correcting a wrong
    // guess re-points the existing rule, which is how accuracy improves.
    const upsert = planRuleUpsert(
      draft.parsed.merchant,
      subcategoryId,
      draft.hint,
      get().merchantRules,
    );
    if (upsert) merchantRuleRepo.apply(upsert);

    /*
     * Resolve the stored row as well as the in-memory list.
     *
     * A draft's id IS its `sms_inbox` row id (see `loadSmsDrafts`), so this
     * settles the queue durably. Without it the row would stay `pending` and the
     * draft would come back the next time the queue is loaded — already logged,
     * and offered for logging again.
     */
    smsInboxRepo.resolve(draftId, 'confirmed');
    set({ smsDrafts: smsDrafts.filter((d) => d.id !== draftId) });
    get().refresh();

    // Share this resolution with the catalog. Un-awaited and failure-swallowing:
    // confirming a draft must feel instant and must never fail because a network
    // call did.
    void get().contributeDraft(draft, subcategoryId);
  },

  dismissDraft(draftId) {
    // Kept as a `dismissed` row rather than deleted, so its fingerprint still
    // rejects the same message if the automation delivers it again.
    smsInboxRepo.resolve(draftId, 'dismissed');
    set({ smsDrafts: get().smsDrafts.filter((d) => d.id !== draftId) });
  },
}));

// ------------------------------------------------------------- selectors

/** A category with its subcategories, flattened and ready for status UI. */
export interface CategoryView {
  category: Category;
  card: Card | undefined;
  subcategories: PlannedCategory[];
  rawSubcategories: Subcategory[];
  summary: CategorySummary;
  /** Whether the category's bulk money has been transferred this period. */
  transferStatus: CategoryFundingStatus;
  /**
   * True when every line in the category is income. Income lands directly in
   * the account, so there is nothing to "transfer" — the UI hides that action.
   */
  isIncomeOnly: boolean;
}

function toPlanned(
  subcategory: Subcategory,
  state: SubcategoryState | undefined,
  transactionTotal: Minor | undefined,
): PlannedCategory {
  /*
   * A spending-budget line (stored as `unplanned`) has no per-period paid flag:
   * its effective value is the SUM of its child transactions, always reported as
   * "actual" so the board and its entry list can never disagree.
   *
   * It DOES carry a planned amount — the monthly budget — which is what the
   * board should plan for. Reporting `plannedMinor: 0` (as this did before
   * budgets existed) made a grocery budget invisible in the month's plan until
   * money was actually spent, so the total to fund jumped around mid-month.
   * Planning the budget and recording the spend against it is what makes
   * "Rs 8,400 of Rs 20,000" true on both screens.
   *
   * It reads as paid whenever there is any spend, so it never sits in the
   * outstanding-bills list demanding to be ticked off.
   */
  if (subcategory.frequency === 'unplanned') {
    const total = transactionTotal ?? 0;
    return {
      id: subcategory.id,
      name: subcategory.name,
      plannedMinor: subcategory.plannedMinor,
      actualMinor: total,
      status: total > 0 ? 'paid' : 'pending',
      type: subcategory.type,
      // Real money already spent this month — never spread across the year.
      frequency: 'unplanned',
      period: periodKey(subcategory.createdAt),
    };
  }

  return {
    id: subcategory.id,
    name: subcategory.name,
    plannedMinor: subcategory.plannedMinor,
    actualMinor: state?.actualMinor ?? null,
    status: (state?.status as SubcategoryStatus) ?? 'pending',
    // Carried through so the summary can keep income out of planned spend.
    type: subcategory.type,
    /*
     * A yearly line is reported as yearly so the summary can spread it over the
     * months it is saved for — EXCEPT when it carries a saving plan, where
     * `plannedMinor` is already the monthly set-aside (the annual total lives in
     * `planTargetMinor`). Dividing that again would understate the plan by 12x,
     * so such lines are declared monthly, which they effectively are.
     */
    frequency:
      subcategory.planTargetMinor != null && subcategory.frequency === 'yearly'
        ? 'monthly'
        : subcategory.frequency,
    /*
     * The month a one-time cost belongs to: the month the user says it was
     * paid, falling back to the month the line was created for rows written
     * before that field existed. The distinction matters — a cost paid in May
     * can be recorded in July, and anchoring to creation would then count it in
     * the wrong month.
     */
    period: subcategory.onceInPeriod ?? periodKey(subcategory.createdAt),
  };
}

/**
 * Cache for `selectCategoryViews`, keyed by the exact state slices it reads.
 *
 * This selector is the app's hot path: six other selectors call it internally,
 * and the dashboard runs seven of those in one render — so a single mount
 * rebuilt every category view roughly a dozen times. On a real device that
 * measured as a 400ms block on the JS thread during launch.
 *
 * A one-entry cache is enough because the store replaces these arrays wholesale
 * on every `refresh()`, so reference equality is an exact test for "the data
 * did not change" — no deep comparison and no staleness risk. Anything that
 * mutates the board goes through `refresh()`, which produces new references and
 * invalidates this automatically.
 */
let categoryViewsCache: { deps: unknown[]; value: CategoryView[] } | null = null;

export function selectCategoryViews(state: AppState): CategoryView[] {
  const deps = [
    state.categories,
    state.subcategories,
    state.states,
    state.categoryStates,
    state.fundingTotals,
    state.transactionTotals,
    state.cards,
    state.period,
  ];

  if (
    categoryViewsCache &&
    categoryViewsCache.deps.length === deps.length &&
    categoryViewsCache.deps.every((dep, i) => dep === deps[i])
  ) {
    return categoryViewsCache.value;
  }

  const value = buildCategoryViews(state);
  categoryViewsCache = { deps, value };
  return value;
}

function buildCategoryViews(state: AppState): CategoryView[] {
  return state.categories.map((category) => {
    const subs = state.subcategories.filter((s) => s.categoryId === category.id);
    const planned = subs.map((s) =>
      toPlanned(s, state.states.get(s.id), state.transactionTotals.get(s.id)),
    );
    const funded = state.fundingTotals.get(category.id) ?? 0;

    return {
      category,
      card: state.cards.find((c) => c.id === category.cardId),
      subcategories: planned,
      rawSubcategories: subs,
      // Scoped to the viewed month so a one-time cost counts only in its own.
      summary: summariseCategory(planned, funded, state.period),
      transferStatus: state.categoryStates.get(category.id)?.status ?? 'pending',
      isIncomeOnly: subs.length > 0 && subs.every((s) => s.type === 'income'),
    };
  });
}

/** All transactions for an unplanned subcategory in the current period, newest
 * first — drives the entry list on the subcategory and list screens. Reads the
 * DB directly (not the totals map) since the UI needs each row, not just a sum. */
export function selectTransactions(state: AppState, subcategoryId: string): Transaction[] {
  return transactionRepo.bySubcategoryPeriod(subcategoryId, state.period);
}

export function selectCategoryView(state: AppState, categoryId: string): CategoryView | undefined {
  return selectCategoryViews(state).find((view) => view.category.id === categoryId);
}

/**
 * Subcategories a draft can be logged against, restricted to the matching type
 * (a credit → income lines, a debit/bill → expense lines) so the picker never
 * offers a nonsensical target. Ordered as the reconciler ranked them.
 */
export function selectDraftTargets(state: AppState, draftId: string): Subcategory[] {
  const draft = state.smsDrafts.find((d) => d.id === draftId);
  if (!draft) return [];

  /*
   * Every line the user could sensibly log against, MATCHING FIRST.
   *
   * This used to hard-filter by direction — a debit saw only `expense` lines —
   * which meant most of the board simply vanished from the picker. Two ways
   * that goes wrong: the parser reads the direction from wording and can get it
   * backwards (a refund, an own-account transfer), and a user may legitimately
   * want a credit against a line typed as an expense. Hiding those left no
   * route to the right bill at all.
   *
   * So the likely type leads and the rest follow, rather than being removed.
   * Archived lines are excluded outright — they are deleted, not merely
   * unlikely, and offering one would resurrect a line the user removed.
   */
  const likelyType = draft.parsed.direction === 'credit' ? 'income' : 'expense';
  const live = state.subcategories.filter((s) => s.archivedAt == null);

  return [
    ...live.filter((s) => s.type === likelyType),
    ...live.filter((s) => s.type !== likelyType),
  ];
}

/** The category name a subcategory belongs to — for draft picker labels. */
export function categoryNameOf(state: AppState, subcategoryId: string): string {
  const sub = state.subcategories.find((s) => s.id === subcategoryId);
  const category = sub && state.categories.find((c) => c.id === sub.categoryId);
  return category?.name ?? '';
}

export function selectBoardTotals(state: AppState): BoardTotals {
  return summariseBoard(selectCategoryViews(state).map((view) => view.summary));
}

/**
 * Everything expected to come in this month.
 *
 * Income arrives two ways and both must count, or the dashboard compares spend
 * against only part of the money: the dedicated `incomes` table (salary and the
 * like), plus any board line explicitly typed as income. Without the second,
 * a plan whose income lives on the board reads as spending far beyond its means.
 */
export function selectTotalIncome(state: AppState): Minor {
  const declared = sumMinor(state.incomes.map((income) => income.amountMinor));

  /*
   * Board income lines, minus any that the `incomes` table already declares.
   *
   * Onboarding writes a salary BOTH ways — as a board line and as an income row
   * — so adding the two sources wholesale counted it twice, and the dashboard
   * reported double the real figure. Matching on name and amount is enough to
   * spot that pairing: they are created together from one entry, so they agree
   * exactly, while two genuinely separate sources that happen to share a name
   * would also share an amount and be a duplicate in substance anyway.
   */
  const declaredKeys = new Set(
    state.incomes.map((income) => `${income.name.trim().toLowerCase()}:${income.amountMinor}`),
  );

  const onBoard = sumMinor(
    selectCategoryViews(state).flatMap((view) =>
      view.rawSubcategories
        .filter(
          (line) =>
            line.type === 'income' &&
            !declaredKeys.has(`${line.name.trim().toLowerCase()}:${line.plannedMinor}`),
        )
        .map((line) => line.plannedMinor),
    ),
  );

  return declared + onBoard;
}

/**
 * The spreadsheet's ratio block. A category counts as debt when it contains
 * any loan-linked subcategory, so the split follows the data rather than a
 * name match.
 */
export function selectRatios(state: AppState): Ratios {
  const views = selectCategoryViews(state);

  let loan = 0;
  let living = 0;

  /*
   * Split per *line*, not per category. Every loan now lives under the one
   * shared Debt category, so a category-level test would count anything else
   * filed there as debt — and, before consolidation, would have counted a whole
   * mixed category as debt because of a single loan line in it. The loan link
   * is a property of the line, so that is what decides.
   */
  for (const view of views) {
    for (const line of view.subcategories) {
      // Income is not spend and belongs to neither bucket.
      if (!isSpend(line)) continue;
      const raw = view.rawSubcategories.find((s) => s.id === line.id);
      const amount = monthlyAmount(line);
      if (raw?.loanId) loan += amount;
      else living += amount;
    }
  }

  return calculateRatios({
    incomeMinor: selectTotalIncome(state),
    loanMinor: loan,
    livingMinor: living,
  });
}

/** Per-card view: what it holds and which categories draw from it. */
export interface CardView {
  card: Card;
  /** Opening balance, plus what was funded in, minus what has been paid out. */
  balanceMinor: Minor;
  fundedInMinor: Minor;
  /** Value of bills drawing on this card already marked paid this period. */
  spentMinor: Minor;
  /** Total every leaf resolved to this card still plans to spend. */
  committedMinor: Minor;
  categoryNames: string[];
}

export function selectCardViews(state: AppState): CardView[] {
  const views = selectCategoryViews(state);

  return state.cards.map((card) => {
    const attachedCategories = views.filter((view) => view.category.cardId === card.id);
    const fundedIn = sumMinor(attachedCategories.map((view) => view.summary.fundedMinor));

    // Committed and spent are resolved per-leaf, since a subcategory can
    // override its category's default funding card.
    let committed = 0;
    let spent = 0;
    for (const view of views) {
      for (const sub of view.rawSubcategories) {
        const resolved = resolveCardId(sub.cardId, view.category.cardId);
        if (resolved !== card.id) continue;
        const planned = view.subcategories.find((p) => p.id === sub.id);
        if (!planned) continue;
        // Income arrives in the account; it is neither a bill to pay nor a
        // deduction from the balance, so it takes no part in either figure.
        if (sub.type === 'income') continue;
        const amount = planned.actualMinor ?? planned.plannedMinor;
        if (planned.status === 'paid') spent += amount;
        else committed += amount;
      }
    }

    return {
      card,
      // A balance is money in *minus money out*. Funding moves money onto the
      // card and paying a bill takes it off again; without the subtraction the
      // figure only ever grows and overstates what the account actually holds.
      balanceMinor: card.openingBalanceMinor + fundedIn - spent,
      fundedInMinor: fundedIn,
      spentMinor: spent,
      committedMinor: committed,
      categoryNames: attachedCategories.map((view) => view.category.name),
    };
  });
}

/**
 * What one account needs to receive this month: the sum of every planned line
 * that draws from it and has not yet been transferred.
 *
 * This is the dashboard's "move this much to each account" answer. It resolves
 * per leaf (a subcategory can override its category's card), and splits the
 * total by whether the line's CATEGORY has been marked transferred — the state
 * the dashboard's slider writes.
 *
 * Deliberately not keyed on whether the bills are paid. Paying a bill from an
 * account says nothing about whether the salary money was moved there, and
 * conflating the two made an account with settled bills read as "all moved"
 * before the user had transferred anything.
 */
export interface AccountTransferView {
  card: Card;
  /** Still to move onto this card. */
  toTransferMinor: Minor;
  /** Everything planned against this card this month, moved or not. */
  plannedMinor: Minor;
  /** Already moved (transferred or completed). */
  movedMinor: Minor;
  /** Number of lines still awaiting a transfer. */
  pendingCount: number;
  /** Category names drawing from this card, for the row's subtitle. */
  categoryNames: string[];
}

export function selectAccountTransfers(state: AppState): AccountTransferView[] {
  const views = selectCategoryViews(state);

  return state.cards
    .map((card) => {
      let toTransfer = 0;
      let planned = 0;
      let moved = 0;
      let pendingCount = 0;
      const categoryNames = new Set<string>();

      for (const view of views) {
        for (const sub of view.rawSubcategories) {
          if (resolveCardId(sub.cardId, view.category.cardId) !== card.id) continue;

          const line = view.subcategories.find((p) => p.id === sub.id);
          if (!line) continue;
          // Income lands *in* an account rather than being moved out to it.
          if (sub.type === 'income') continue;

          const amount = line.actualMinor ?? line.plannedMinor;
          planned += amount;
          categoryNames.add(view.category.name);

          /*
           * Moved-ness comes from the CATEGORY's transfer state, not from
           * whether its bills are paid.
           *
           * These are two different real-world steps and were conflated here: a
           * bill being `paid` meant "this account needs no more money", so an
           * account whose bills happened to be settled showed as fully moved
           * even though the user had never transferred anything — and the
           * slider could not be reverted, because the state it reads was never
           * the state it writes.
           *
           * Paying a bill from an account says nothing about whether the salary
           * money was moved there; the user might have paid it from whatever
           * balance was already sitting on the card.
           */
          const transferred =
            (state.categoryStates.get(view.category.id)?.status ?? 'pending') === 'transferred';

          if (transferred) {
            moved += amount;
          } else {
            toTransfer += amount;
            pendingCount += 1;
          }
        }
      }

      return {
        card,
        toTransferMinor: toTransfer,
        plannedMinor: planned,
        movedMinor: moved,
        pendingCount,
        categoryNames: [...categoryNames],
      };
    })
    .filter((view) => view.plannedMinor > 0)
    .sort((a, b) => b.toTransferMinor - a.toTransferMinor);
}

/**
 * An unpaid line surfaced on the dashboard, with how close its due date is.
 * Overdue first, then soonest — the order the user should act in.
 */
export interface ReminderView {
  subcategory: Subcategory;
  categoryName: string;
  categoryColor: string;
  card: Card | undefined;
  amountMinor: Minor;
  status: SubcategoryStatus;
  dueDate: Date;
  daysUntil: number;
  urgency: DueUrgency;
}

/** A bill with a saving plan, plus how far along it is. */
export interface SavingPlanView {
  subcategory: Subcategory;
  categoryName: string;
  categoryColor: string;
  plan: SavingPlan;
  progress: SavingPlanProgress;
}

/**
 * Every bill that carries a saving plan, with progress derived from how many
 * months have actually been marked paid since the plan started.
 *
 * Counting *paid months* rather than a stored running total means the figure
 * can never drift from the checklist the user actually ticks, and re-opening
 * an old month corrects it automatically.
 */
export function selectSavingPlans(state: AppState, today = new Date()): SavingPlanView[] {
  const plans: SavingPlanView[] = [];

  for (const category of state.categories) {
    for (const sub of state.subcategories) {
      if (sub.categoryId !== category.id) continue;
      if (sub.planTargetMinor == null || !sub.planDueDate) continue;

      const plan: SavingPlan = {
        targetMinor: sub.planTargetMinor,
        dueDate: sub.planDueDate,
        startDate: sub.planStartDate ?? sub.createdAt,
      };

      // Each paid month contributed that month's planned set-aside.
      const paidPeriods = stateRepo.paidPeriodCount(sub.id);
      const saved = paidPeriods * sub.plannedMinor;

      plans.push({
        subcategory: sub,
        categoryName: category.name,
        categoryColor: category.color,
        plan,
        progress: savingPlanProgress(plan, saved, today),
      });
    }
  }

  // Soonest due first — the ones needing attention lead.
  return plans.sort((a, b) => a.progress.daysUntilDue - b.progress.daysUntilDue);
}

export function selectReminders(state: AppState, today = new Date()): ReminderView[] {
  const reminders: ReminderView[] = [];

  for (const category of state.categories) {
    const subs = state.subcategories.filter((s) => s.categoryId === category.id);
    for (const sub of subs) {
      if (sub.type === 'income') continue;

      /*
       * A spending budget is never a reminder.
       *
       * It has no single payment to make and is never ticked "paid" as a whole
       * — its spend is the running sum of its entries — so it could never leave
       * this list once its due day passed. A grocery budget sat on the
       * dashboard reading "2 days overdue" permanently, which is both wrong and
       * the kind of false alarm that teaches people to ignore the section.
       *
       * Its money is handled by the account transfer, and its spending shows on
       * the plan as a running total against the budget. Neither is a deadline.
       */
      if (isUnplanned(sub.frequency)) continue;

      const status: SubcategoryStatus =
        (state.states.get(sub.id)?.status as SubcategoryStatus) ?? 'pending';
      // Paid means done — nothing left to remind about.
      if (status === 'paid') continue;

      // A flexible bill has no fixed date, so it can never be "overdue" and
      // must not appear in the due-date reminder list.
      const effectiveDueDay = sub.dueDay ?? category.dueDay;
      if (isFlexibleDueDay(effectiveDueDay)) continue;

      const dueDate = dueDateFor(state.period, effectiveDueDay);
      reminders.push({
        subcategory: sub,
        categoryName: category.name,
        categoryColor: category.color,
        card: state.cards.find(
          (c) => c.id === resolveCardId(sub.cardId, category.cardId),
        ),
        /*
         * `??` is wrong here and was the "LKR 0" on screen: a logged actual of
         * zero is not nullish, so it won any comparison against the plan. A
         * bill can legitimately be logged at 0 (a waived charge), and the
         * reminder should then show what is still PLANNED, not the zero.
         */
        amountMinor: state.states.get(sub.id)?.actualMinor || sub.plannedMinor,
        status,
        dueDate,
        daysUntil: daysUntil(dueDate, today),
        urgency: urgencyFor(dueDate, today),
      });
    }
  }

  return reminders.sort((a, b) => a.daysUntil - b.daysUntil);
}

export interface LoanView {
  loan: Loan;
  installmentMinor: Minor;
  totalInterestMinor: Minor;
  paidCount: number;
  remainingMinor: Minor;
  progressPct: number;
}

export function selectLoanViews(state: AppState): LoanView[] {
  return state.loans.map((loan) => {
    const terms = {
      principalMinor: loan.principalMinor,
      annualRatePct: loan.annualRatePct,
      termMonths: loan.termMonths,
    };
    const schedule = buildSchedule(terms);
    // Prefer the explicit "installments paid" the user entered; fall back to
    // deriving it from the start date for loans created before that field
    // existed (where it defaults to 0).
    const paidCount =
      loan.paidInstallments > 0
        ? Math.min(loan.paidInstallments, loan.termMonths)
        : paymentsElapsed(loan.startDate, loan.termMonths);

    return {
      loan,
      installmentMinor: schedule.installmentMinor,
      totalInterestMinor: schedule.totalInterestMinor,
      paidCount,
      remainingMinor: remainingBalance(terms, paidCount),
      progressPct: loan.termMonths > 0 ? (paidCount / loan.termMonths) * 100 : 0,
    };
  });
}
