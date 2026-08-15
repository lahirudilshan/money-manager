/**
 * The pick-list that drives onboarding step 2.
 *
 * Onboarding asks the user to *recognise* their expenses rather than invent
 * and type them, so this catalog aims for coverage of ordinary Sri Lankan
 * household spending. Every suggestion carries a sensible default due-day and
 * an `income` flag where relevant; amounts are deliberately absent — step 3
 * collects those, and a wrong prefilled number is worse than an empty field.
 */

import type { Ionicons } from '@expo/vector-icons';

export interface CatalogSubcategory {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  type?: 'income' | 'expense';
  /** Default day of month; step 3 lets the user change it. */
  dueDay?: number;
  /**
   * `unplanned` is allowed because a HOUSE's cost is not a single figure paid
   * once a month — it is the sum of whatever its bills came to. See the
   * `houses` category below and `subcategories.frequency` in db/schema.ts.
   */
  frequency?: 'monthly' | 'one_time' | 'yearly' | 'unplanned';
  /** Preselected when its parent category is chosen — the common cases. */
  common?: boolean;
}

export interface CatalogCategory {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  blurb: string;
  subcategories: CatalogSubcategory[];
}

export const CATEGORY_CATALOG: CatalogCategory[] = [
  {
    id: 'income',
    name: 'Income',
    icon: 'trending-up-outline',
    color: '#0E9F6E',
    blurb: 'What comes in each month',
    subcategories: [
      { id: 'salary', name: 'Salary', icon: 'wallet-outline', type: 'income', dueDay: 25, common: true },
      { id: 'freelance', name: 'Freelance / side work', icon: 'laptop-outline', type: 'income' },
      { id: 'rent-income', name: 'Rent received', icon: 'key-outline', type: 'income' },
      { id: 'interest', name: 'Interest / dividends', icon: 'trending-up-outline', type: 'income' },
      { id: 'other-income', name: 'Other income', icon: 'add-circle-outline', type: 'income' },
    ],
  },
  {
    id: 'housing',
    name: 'Housing',
    icon: 'home-outline',
    color: '#0F6FDE',
    blurb: 'Rent, utilities, and the roof over your head',
    subcategories: [
      { id: 'rent', name: 'Rent / mortgage', icon: 'home-outline', dueDay: 1, common: true },
      { id: 'electricity', name: 'Electricity (CEB / LECO)', icon: 'flash-outline', dueDay: 10, common: true },
      { id: 'water', name: 'Water', icon: 'water-outline', dueDay: 10, common: true },
      { id: 'gas', name: 'Gas', icon: 'flame-outline', dueDay: 5 },
      { id: 'internet', name: 'Internet / broadband', icon: 'wifi-outline', dueDay: 5, common: true },
      { id: 'maintenance', name: 'Repairs & maintenance', icon: 'construct-outline' },
      { id: 'domestic-help', name: 'Domestic help', icon: 'people-outline', dueDay: 1 },
      { id: 'garbage', name: 'Garbage / municipal', icon: 'trash-outline' },
    ],
  },
  /*
   * Houses — one line per property the user pays for.
   *
   * This category is a DIMENSION made visible, not a replacement for the bills
   * under Housing. The user's electricity still lives on the Electricity line;
   * what these lines carry is the per-property BUDGET ("Weligama costs me about
   * 10,000 a month"), against which the house-tagged payments accumulate.
   *
   * `unplanned` on every line, because a house's cost is the sum of whatever
   * its bills came to — not a single figure paid once a month. See
   * `HOUSE_SCOPED_CATALOG_IDS` in core/houses.ts for which BILLS ask which
   * house they belong to; this category is where the answers add up.
   */
  {
    id: 'houses',
    name: 'Houses',
    icon: 'home-outline',
    color: '#0F6FDE',
    blurb: 'Properties whose bills you pay',
    subcategories: [
      { id: 'house-own', name: 'My home', icon: 'home-outline', frequency: 'unplanned', common: true },
      { id: 'house-parents', name: "Primary parent's home", icon: 'home-outline', frequency: 'unplanned' },
      { id: 'house-second', name: "Secondary parent's home", icon: 'home-outline', frequency: 'unplanned' },
      { id: 'house-rented-out', name: 'Rented out', icon: 'key-outline', frequency: 'unplanned' },
    ],
  },
  {
    id: 'living',
    name: 'Living',
    icon: 'basket-outline',
    color: '#B7791F',
    blurb: 'Day-to-day essentials',
    subcategories: [
      /*
       * Food is split in two, and the names say WHERE it was eaten.
       *
       * "Groceries" and "Eating out" are the same substance bought two ways,
       * and keeping them apart is the point: groceries are a fairly fixed
       * monthly need, while eating out is the most elastic line most people
       * have. Merged into one "Food" total neither question can be answered —
       * a rising number says nothing about whether to shop differently or eat
       * out less.
       *
       * The names carry "home" and "outside" because that is the distinction
       * the user actually makes, and because a delivery ordered to the house is
       * still eating out — it is restaurant food, not a grocery run. Without
       * the word, "Eating out" invites exactly that misfiling.
       */
      { id: 'groceries', name: 'Groceries (home food)', icon: 'basket-outline', dueDay: 1, common: true },
      {
        id: 'dining',
        name: 'Eating out & delivery',
        icon: 'restaurant-outline',
        common: true,
      },
      { id: 'household', name: 'Household items', icon: 'cube-outline' },
      /*
       * Cash taken out, as its own line.
       *
       * ATM withdrawals were being proposed against "Household items", which
       * is wrong twice over: the money has not been spent on anything yet, and
       * lumping it there makes that line's total meaningless. Cash in hand is a
       * real category people track — this is where a withdrawal belongs until
       * they say otherwise.
       */
      { id: 'cash', name: 'Cash / pocket money', icon: 'cash-outline' },
      { id: 'clothing', name: 'Clothing', icon: 'shirt-outline' },
      { id: 'personal-care', name: 'Personal care', icon: 'cut-outline' },
      { id: 'mobile', name: 'Mobile / phone bill', icon: 'phone-portrait-outline', dueDay: 5, common: true },
    ],
  },
  {
    id: 'transport',
    name: 'Transport',
    icon: 'car-sport-outline',
    color: '#0FA8A0',
    blurb: 'Getting around',
    subcategories: [
      { id: 'fuel', name: 'Fuel', icon: 'speedometer-outline', common: true },
      { id: 'vehicle-service', name: 'Service & repairs', icon: 'build-outline' },
      { id: 'vehicle-insurance', name: 'Vehicle insurance', icon: 'shield-outline', frequency: 'yearly' },
      { id: 'license', name: 'Revenue licence', icon: 'document-text-outline', frequency: 'yearly' },
      { id: 'parking', name: 'Parking & tolls', icon: 'car-outline' },
      { id: 'public-transport', name: 'Bus / train / taxi', icon: 'bus-outline' },
    ],
  },
  {
    id: 'loans',
    name: 'Loans & credit',
    icon: 'card-outline',
    color: '#DC2626',
    blurb: 'Instalments and repayments',
    subcategories: [
      { id: 'personal-loan', name: 'Personal loan', icon: 'cash-outline', dueDay: 5, common: true },
      { id: 'lease', name: 'Vehicle lease', icon: 'car-sport-outline', dueDay: 5 },
      { id: 'housing-loan', name: 'Housing loan', icon: 'home-outline', dueDay: 5 },
      { id: 'credit-card', name: 'Credit card payment', icon: 'card-outline', dueDay: 15, common: true },
      { id: 'pawning', name: 'Pawning', icon: 'diamond-outline' },
    ],
  },
  {
    id: 'family',
    name: 'Family',
    icon: 'people-outline',
    color: '#7C8A3D',
    blurb: 'Children, parents, and support',
    subcategories: [
      { id: 'school-fees', name: 'School fees', icon: 'school-outline', dueDay: 1 },
      { id: 'tuition', name: 'Tuition / classes', icon: 'book-outline', dueDay: 1 },
      { id: 'childcare', name: 'Childcare', icon: 'happy-outline' },
      /*
       * "Support to parents" deliberately absent.
       *
       * A parent's household is a PROPERTY whose bills the user pays, which is
       * exactly what the Houses category above models — and a house line
       * accumulates whatever its bills actually came to, where a single monthly
       * "support" figure is a guess that the real payments then contradict.
       * Having both meant the same money could be counted twice, on two lines
       * that never agreed.
       */
      { id: 'kids-extras', name: "Children's extras", icon: 'balloon-outline' },
    ],
  },
  {
    id: 'health',
    name: 'Health',
    icon: 'medkit-outline',
    color: '#0891B2',
    blurb: 'Medical and wellbeing',
    subcategories: [
      { id: 'health-insurance', name: 'Health insurance', icon: 'shield-checkmark-outline', dueDay: 1 },
      { id: 'medicine', name: 'Medicine', icon: 'medkit-outline' },
      { id: 'doctor', name: 'Doctor / channelling', icon: 'pulse-outline' },
      { id: 'gym', name: 'Gym / fitness', icon: 'barbell-outline', dueDay: 1 },
    ],
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: 'repeat-outline',
    color: '#2E6BB8',
    blurb: 'Recurring digital spend',
    subcategories: [
      { id: 'streaming', name: 'Streaming (Netflix etc.)', icon: 'play-circle-outline', dueDay: 1 },
      { id: 'music', name: 'Music', icon: 'musical-notes-outline', dueDay: 1 },
      { id: 'cloud', name: 'Cloud storage', icon: 'cloud-outline', dueDay: 1 },
      { id: 'software', name: 'Software / apps', icon: 'apps-outline', dueDay: 1 },
      { id: 'news', name: 'News / memberships', icon: 'newspaper-outline', dueDay: 1 },
    ],
  },
  /*
   * Bank fees — one line for every kind of charge.
   *
   * Splitting them by type (transfer fees, stamp duty, ATM fees) would produce
   * a handful of lines each holding a few rupees, which tells the user nothing.
   * The useful question is "what did my bank cost me this month", and that is a
   * single total.
   *
   * `unplanned` because fees accumulate — several arrive in a month and a
   * monthly line would hold only ONE actual, so the second charge would
   * overwrite the first instead of adding to it. Nobody budgets for them
   * either, so the total reads honestly as unplanned spend.
   */
  {
    id: 'bank-fees',
    name: 'Bank & fees',
    icon: 'business-outline',
    color: '#5B6472',
    blurb: 'What your bank charges you',
    subcategories: [
      {
        id: 'bank-charges',
        name: 'Bank charges',
        icon: 'receipt-outline',
        frequency: 'unplanned',
        common: true,
      },
    ],
  },
  {
    id: 'savings',
    name: 'Savings & goals',
    icon: 'shield-checkmark-outline',
    color: '#0E9F6E',
    blurb: 'Money you set aside on purpose',
    subcategories: [
      { id: 'emergency', name: 'Emergency fund', icon: 'umbrella-outline', dueDay: 25, common: true },
      { id: 'fixed-deposit', name: 'Fixed deposit', icon: 'lock-closed-outline', dueDay: 25 },
      { id: 'investments', name: 'Investments', icon: 'trending-up-outline', dueDay: 25 },
      { id: 'vehicle-fund', name: 'Vehicle fund', icon: 'car-sport-outline' },
      { id: 'travel-fund', name: 'Travel fund', icon: 'airplane-outline' },
      { id: 'retirement', name: 'Retirement', icon: 'hourglass-outline' },
    ],
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    icon: 'sparkles-outline',
    color: '#5B6472',
    blurb: 'The enjoyable extras',
    subcategories: [
      { id: 'entertainment', name: 'Entertainment', icon: 'film-outline' },
      { id: 'travel', name: 'Travel & trips', icon: 'airplane-outline' },
      { id: 'gifts', name: 'Gifts', icon: 'gift-outline' },
      { id: 'donations', name: 'Donations / dana', icon: 'heart-circle-outline' },
      { id: 'hobbies', name: 'Hobbies', icon: 'color-palette-outline' },
      { id: 'events', name: 'Weddings & events', icon: 'people-circle-outline' },
    ],
  },
];

/**
 * Catalog categories the onboarding picker does NOT show.
 *
 * Both are still real categories — they are simply not things to *choose* in
 * step 2:
 *
 *   - `loans`: step 5 asks about loans and leases properly, with the lender,
 *     rate and term that make an installment calculable. Picking "Personal loan"
 *     here as a bare monthly amount produced a second, dumber copy of the same
 *     debt, and the user then had to reconcile two lines that disagreed.
 *   - `bank-fees`: nobody plans their bank charges, and asking them to opt in to
 *     a line they will certainly incur is a question with one sensible answer.
 *     It is created automatically instead — see `DEFAULT_CATALOG_IDS`.
 *
 * The catalog itself is left whole so the SMS hint catalog, restore, and every
 * lookup by id keep working; this list only narrows what step 2 renders.
 */
export const ONBOARDING_HIDDEN_CATEGORY_IDS = new Set(['loans', 'bank-fees']);

/** The categories onboarding step 2 offers, in catalog order. */
export const ONBOARDING_CATALOG: CatalogCategory[] = CATEGORY_CATALOG.filter(
  (category) => !ONBOARDING_HIDDEN_CATEGORY_IDS.has(category.id),
);

/**
 * Lines every new board gets without being asked.
 *
 * Bank charges arrive whether or not anyone planned for them, and the SMS
 * parser already routes fees to this line by id (see `hintCatalog.ts`) — so
 * without it those messages land with nowhere to go.
 */
export const DEFAULT_CATALOG_IDS = ['bank-charges'];

/** Flat lookup so step 3 can resolve a picked id back to its definition. */
export const CATALOG_SUBCATEGORY_BY_ID = new Map<
  string,
  { category: CatalogCategory; subcategory: CatalogSubcategory }
>(
  CATEGORY_CATALOG.flatMap((category) =>
    category.subcategories.map(
      (subcategory) => [subcategory.id, { category, subcategory }] as const,
    ),
  ),
);
