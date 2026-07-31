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
import { parseSms } from '../core/smsParser';
import { reconcileSms, type SmsDraft } from '../core/smsReconcile';
import { planRuleUpsert, type MerchantRule } from '../core/merchantRules';
import { createId } from '../db/repositories';
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
  stateRepo,
  subcategoryRepo,
  transactionRepo,
  SETTINGS_KEYS,
} from '../db/repositories';
import { seedSampleTemplate } from '../db/seed';
import { cancelAllReminders } from '../services/notifications';
import { supportsSavingPlan } from '../db/schema';
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

  initialise: () => Promise<void>;
  refresh: () => void;
  setPeriod: (period: string) => void;
  setCurrency: (currency: string) => void;
  setUsdRate: (rate: number) => void;
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setAppLockEnabled: (enabled: boolean) => void;
  setPlan: (plan: PlanId) => void;
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
  toggleCategoryTransfer: (categoryId: string) => void;

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

  toggleCategoryTransfer(categoryId) {
    const { period, categoryStates } = get();
    const current = categoryStates.get(categoryId)?.status ?? 'pending';
    categoryStateRepo.setStatus(
      categoryId,
      period,
      current === 'transferred' ? 'pending' : 'transferred',
    );
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

    const { smsDrafts, subcategories, categories, cards, merchantRules, currency, usdRate } = get();

    // Ignore an identical raw text that is already waiting — re-firing the same
    // deep link (iOS Shortcuts can deliver a message more than once) should not
    // pile up duplicate drafts for the user to dismiss.
    // 'duplicate' rather than null: the caller logs the outcome, and reporting
    // this as a parse failure made a successful deep link show an error beside
    // its own success (both the layout listener and the sms/index route ingest
    // a cold-start link, so the second delivery always lands here).
    if (smsDrafts.some((draft) => draft.parsed.raw === parsed.raw)) return 'duplicate';

    const draft = reconcileSms(
      parsed,
      { subcategories, categories, cards },
      createId(),
      merchantRules,
      // A foreign-currency alert (an inward USD salary, say) is converted to the
      // user's currency before it is matched or logged — the board is entirely
      // in one currency, so an unconverted figure would match nothing and record
      // a salary as pocket change.
      { currency, usdRate },
    );

    set({ smsDrafts: [draft, ...smsDrafts] });
    return draft.id;
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

    set({ smsDrafts: smsDrafts.filter((d) => d.id !== draftId) });
    get().refresh();
  },

  dismissDraft(draftId) {
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
 * per leaf (a subcategory can override its category's card), and counts only
 * lines still awaiting money — once a line is transferred or completed, its
 * cash is already sitting on the card.
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

          if (line.status === 'pending') {
            toTransfer += amount;
            pendingCount += 1;
          } else {
            moved += amount;
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
  /** Whether the bulk money for this bill's category has landed. */
  categoryTransferred: boolean;
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
    const categoryTransferred =
      (state.categoryStates.get(category.id)?.status ?? 'pending') === 'transferred';

    for (const sub of subs) {
      if (sub.type === 'income') continue;

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
        amountMinor: state.states.get(sub.id)?.actualMinor ?? sub.plannedMinor,
        status,
        categoryTransferred,
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
