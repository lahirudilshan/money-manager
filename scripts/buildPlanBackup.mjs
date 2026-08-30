/**
 * Builds a restorable backup snapshot from the personal planning spreadsheet.
 *
 * ## Why a backup file rather than a seeder in src/
 *
 * The app already has a tested restore path (Settings -> Backup & restore) with
 * two scopes, integrity checks and a confirmation screen. A seeder would have
 * been a second, parallel way to write the same rows — and it would have put
 * real salary and loan figures into production source. This keeps the figures
 * in a data file the user owns and can re-import whenever they want to reset.
 *
 * ## Everything here is expressed in CATALOG ids
 *
 * The shared taxonomy lives in `src/shared/data/categoryCatalog.ts` and is what
 * every user's board is built from. This plan does not invent categories: it
 * picks catalog lines and attaches amounts. That matters beyond tidiness —
 * catalog ids are the join key for
 *
 *   - SMS routing      (features/sms/logic/hintCatalog.ts maps hints to ids)
 *   - house scoping    (budget/logic/houses.ts HOUSE_SCOPED_CATALOG_IDS)
 *
 * so a hand-invented id like `plan_sub_food` produces a line Smart Detect can
 * never file a message against. The catalog also supplies each line's name,
 * icon, due-day and frequency, so the only thing the sheet contributes is money.
 *
 * The catalog id is NOT a database column (see db/schema.ts) — it is a build
 * -time key. It is carried into the row `id` so the mapping stays legible and
 * re-importing updates rows in place.
 *
 * Run:  node scripts/buildPlanBackup.mjs
 * Out:  backups/money-manager-<timestamp>.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/*
 * The filename MATTERS: the restore screen only lists files matching
 * `isSnapshotFilename` — `money-manager-*.json` — so anything else is invisible
 * in the app no matter how valid its contents. Timestamped like the app's own
 * saves, so it sorts among them naturally.
 */
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(ROOT, `backups/money-manager-${STAMP}.json`);

/** Money is stored as INTEGER minor units — never floats. Mirrors shared/lib/money. */
const minor = (major) => Math.round(major * 100);

const NOW = Date.now();
const DAY = 1000 * 60 * 60 * 24;

// ---------------------------------------------------------------------------
// Read the catalog
//
// Parsed from the TypeScript source rather than imported, because this is a
// plain node script and the app's module graph pulls in React Native. Parsing
// keeps the script dependency-free while still failing loudly if an id it
// names has been renamed or removed.
// ---------------------------------------------------------------------------

const catalogSrc = readFileSync(resolve(ROOT, 'src/shared/data/categoryCatalog.ts'), 'utf8');

/**
 * Every catalog category and line, keyed by id.
 *
 * Walks the source structurally rather than matching whole objects with one
 * regex: the file is full of doc comments sitting BETWEEN fields, and a regex
 * loose enough to skip them also swallows the next object. An earlier version
 * did exactly that and silently dropped a whole category — and its bills —
 * from the output.
 *
 * The shape it relies on is stable and simple: a category is an object with a
 * `color`, a line is one without, and `subcategories: [` opens a category's
 * list.
 */
function parseCatalog() {
  const categories = new Map();
  const lines = new Map();

  /** The object literal starting at `open`, as source text. */
  function objectAt(open) {
    let depth = 0;
    for (let i = open; i < catalogSrc.length; i += 1) {
      if (catalogSrc[i] === '{') depth += 1;
      else if (catalogSrc[i] === '}') {
        depth -= 1;
        if (depth === 0) return catalogSrc.slice(open, i + 1);
      }
    }
    return '';
  }

  const field = (body, key, pattern = "'([^']*)'") => {
    const m = body.match(new RegExp(`(?:^|[\\s,{])${key}:\\s*${pattern}`));
    return m ? m[1] : null;
  };

  // Every object literal in the file, outermost first.
  for (let i = 0; i < catalogSrc.length; i += 1) {
    if (catalogSrc[i] !== '{') continue;
    const body = objectAt(i);
    const id = field(body, 'id');
    if (!id) continue;

    // A category declares a colour and owns a `subcategories` array.
    if (field(body, 'color', "'(#[0-9A-Fa-f]{6})'") && body.includes('subcategories:')) {
      const category = {
        id,
        name: field(body, 'name'),
        icon: field(body, 'icon'),
        color: field(body, 'color', "'(#[0-9A-Fa-f]{6})'"),
      };
      categories.set(id, category);

      // Its lines are the objects inside, which brace-matching finds for us.
      const listAt = body.indexOf('subcategories:');
      let depth = 0;
      for (let j = listAt; j < body.length; j += 1) {
        if (body[j] !== '{') continue;
        const lineBody = objectAt(i + j);
        const lineId = field(lineBody, 'id');
        if (!lineId || lineId === id) continue;
        lines.set(lineId, {
          id: lineId,
          name: field(lineBody, 'name') ?? lineId,
          icon: field(lineBody, 'icon'),
          dueDay: Number(field(lineBody, 'dueDay', '(\\d+)')) || null,
          frequency: field(lineBody, 'frequency') ?? 'monthly',
          type: field(lineBody, 'type') ?? 'expense',
          category,
        });
        j += lineBody.length - 1;
        depth += 1;
      }
      i += body.length - 1;
    }
  }

  return { categories, lines };
}

const CATALOG = parseCatalog();

/** Look up a catalog line, failing loudly if the id no longer exists. */
function line(catalogId) {
  const found = CATALOG.lines.get(catalogId);
  if (!found) {
    throw new Error(
      `Catalog id "${catalogId}" not found in categoryCatalog.ts — it was renamed or removed.`,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Accounts
//
// The sheet tags three expense rows with a bank — "Food / HNB (wife)",
// "Fuel / NDB", "Travel / NSB": which account each bill is paid from.
// ---------------------------------------------------------------------------

const cards = [
  {
    id: 'plan_card_hnb',
    name: 'Hatton National Bank',
    kind: 'bank',
    bank_id: 'hnb',
    bank_name: 'HNB',
    nickname: 'Household (wife)',
    color: '#00A6D8',
    icon: 'wallet-outline',
    sort_order: 0,
  },
  {
    id: 'plan_card_ndb',
    name: 'National Development Bank',
    kind: 'bank',
    bank_id: 'ndb',
    bank_name: 'NDB',
    nickname: 'Salary',
    color: '#D0043C',
    icon: 'wallet-outline',
    sort_order: 1,
  },
  {
    id: 'plan_card_nsb',
    name: 'National Savings Bank',
    kind: 'bank',
    bank_id: 'nsb',
    bank_name: 'NSB',
    nickname: 'Travel',
    color: '#EA970B',
    icon: 'wallet-outline',
    sort_order: 2,
  },
  /*
   * The down payment is a savings goal, not a spending account: 2,500,000 is
   * already set aside and 500,000 more is needed to reach 3,000,000.
   */
  {
    id: 'plan_card_downpayment',
    name: 'Vehicle down payment',
    kind: 'goal',
    nickname: 'Down payment',
    color: '#7C3AED',
    icon: 'car-sport-outline',
    target_minor: minor(3_000_000),
    opening_balance_minor: minor(2_500_000),
    sort_order: 3,
  },
];

const SALARY_CARD = 'plan_card_ndb';

// ---------------------------------------------------------------------------
// Houses
//
// Two properties, which is what makes the dimension visible at all — below two
// the UI keeps it hidden. The sheet's "Weligama home" and "Kelaniya home" are
// NOT bills: per the catalog's own reasoning, a parent's household is a
// property whose bills you pay, and a single monthly "support" figure would be
// double-counted against the real payments. They become houses, and the
// Houses-category lines below are where their spend accumulates.
// ---------------------------------------------------------------------------

const houses = [
  {
    id: 'plan_house_kelaniya',
    name: 'Kelaniya',
    is_primary: true,
    color: '#0F6FDE',
    icon: 'home-outline',
    note: 'Primary residence',
    sort_order: 0,
  },
  {
    id: 'plan_house_weligama',
    name: 'Weligama',
    is_primary: false,
    color: '#0F8A4D',
    icon: 'home-outline',
    note: 'Family home',
    sort_order: 1,
  },
];

// ---------------------------------------------------------------------------
// Income
//
// USD 2,500 at LKR 300 = 750,000. The sheet lists "USD Salary 2,500" and
// "LKR Salary 750,000" — the same money twice — and "Future salary 830,000".
//
// Which is current income is settled by the sheet's own ratios: 281,213 /
// 750,000 = 37.50%, exactly matching "Loan percentage from Income". So the
// ratios are computed on 750,000 and 830,000 is a projection, carried as an
// inactive row rather than dropped.
// ---------------------------------------------------------------------------

const incomes = [
  {
    id: 'plan_income_salary',
    name: line('salary').name,
    amount_minor: minor(750_000),
    card_id: SALARY_CARD,
    foreign_amount: 2_500,
    foreign_rate: 300,
    icon: line('salary').icon,
    color: '#0F8A4D',
    is_active: true,
    sort_order: 0,
  },
  {
    id: 'plan_income_salary_future',
    name: 'Salary after raise (projected)',
    amount_minor: minor(830_000),
    card_id: SALARY_CARD,
    icon: 'trending-up-outline',
    color: '#0F8A4D',
    is_active: false,
    sort_order: 1,
  },
];

// ---------------------------------------------------------------------------
// Loans
//
// Both ACTIVE, per the decision to treat the vehicle purchase as going ahead.
//
// interest_method is checked against the sheet rather than assumed:
//   Personal  7,200,000 @ 11.5% / 5y -> 158,347/mo  = EMI (reducing)
//   Lease     5,400,000 @ 13.0% / 5y -> 122,867/mo  = EMI (reducing)
// A flat lease at 13% would be 148,500/mo, so despite `flat` being the common
// local default for leases this sheet was computed on a reducing balance.
// ---------------------------------------------------------------------------

const loans = [
  {
    id: 'plan_loan_personal',
    name: 'Personal loan',
    kind: 'personal',
    principal_minor: minor(7_200_000),
    annual_rate_pct: 11.5,
    interest_method: 'emi',
    term_months: 60,
    start_date: NOW,
    paid_installments: 0,
    color: '#F97316',
    is_active: true,
  },
  {
    id: 'plan_loan_lease',
    name: 'Vehicle lease',
    kind: 'lease',
    principal_minor: minor(5_400_000),
    annual_rate_pct: 13.0,
    interest_method: 'emi',
    term_months: 60,
    start_date: NOW,
    paid_installments: 0,
    color: '#DC2626',
    is_active: true,
  },
];

// ---------------------------------------------------------------------------
// The plan: catalog id -> amount
//
// Grouped by the catalog's own categories, so the board a restore produces is
// the same shape any other user's is. `over` carries the few per-line
// deviations the sheet justifies.
// ---------------------------------------------------------------------------

/** @type {{catalogId: string, amount: number, over?: object}[]} */
const PLAN = [
  // --- Housing -------------------------------------------------------------
  // Rent, electricity and water are house-scoped by the catalog, so each
  // defaults to the primary residence and can be re-tagged per payment.
  { catalogId: 'rent', amount: 35_000, over: { house_id: 'plan_house_kelaniya' } },
  { catalogId: 'electricity', amount: 8_000, over: { house_id: 'plan_house_kelaniya' } },
  { catalogId: 'water', amount: 2_000, over: { house_id: 'plan_house_kelaniya' } },

  /*
   * Internet twice: the sheet has both "Wifi" and "Starlink", which are two
   * separate connections at two properties, not one line. The second overrides
   * the catalog name because "Internet / broadband" twice would be unreadable.
   */
  { catalogId: 'internet', amount: 10_000, over: { name: 'Wifi', house_id: 'plan_house_kelaniya' } },
  {
    catalogId: 'internet',
    amount: 10_000,
    key: 'starlink',
    over: { name: 'Starlink', icon: 'planet-outline', house_id: 'plan_house_weligama' },
  },

  // --- Houses (per-property accumulators) ----------------------------------
  // The sheet's "Kelaniya home 10,000" and "Weligama home 15,000" budgets.
  // `unplanned` by catalog definition: a house's cost is the sum of its bills.
  { catalogId: 'house-own', amount: 10_000, over: { name: 'Kelaniya (home)' } },
  { catalogId: 'house-parents', amount: 15_000, over: { name: 'Weligama (family)' } },

  // --- Living --------------------------------------------------------------
  /*
   * The sheet's single "Food 50,000" is split per the catalog's deliberate
   * groceries/dining separation — the one line the sheet cannot answer is
   * whether to shop differently or eat out less. Split 30/20, which is a guess
   * and the first thing worth correcting once real spend lands.
   */
  { catalogId: 'groceries', amount: 30_000, over: { card_id: 'plan_card_hnb' } },
  { catalogId: 'dining', amount: 20_000, over: { card_id: 'plan_card_hnb' } },
  { catalogId: 'mobile', amount: 3_000 },
  { catalogId: 'pet', amount: 10_000 },

  // --- Health --------------------------------------------------------------
  // Sheet has a flat "health 10,000"; medicine is the closest catalog line and
  // the one SMS pharmacy hints route to.
  { catalogId: 'medicine', amount: 10_000 },

  // --- Transport -----------------------------------------------------------
  /*
   * Two fuel figures in the sheet: 2,000 now (public transport era) and 40,000
   * under vehicle running costs. Once the vehicle is bought the second replaces
   * the first, so `fuel` carries the post-purchase figure and the 2,000 becomes
   * the bus/train line it actually describes.
   */
  { catalogId: 'public-transport', amount: 2_000, over: { card_id: 'plan_card_ndb' } },
  { catalogId: 'fuel', amount: 40_000, over: { card_id: 'plan_card_ndb' } },
  {
    catalogId: 'vehicle-insurance',
    amount: 15_000,
    // Annual premium spread monthly — a sinking fund, not a monthly bill.
    over: {
      frequency: 'monthly',
      plan_target_minor: minor(180_000),
      plan_start_date: NOW,
      plan_due_date: NOW + 365 * DAY,
    },
  },
  { catalogId: 'vehicle-service', amount: 15_000 },

  // --- Lifestyle -----------------------------------------------------------
  { catalogId: 'travel', amount: 15_000, over: { card_id: 'plan_card_nsb' } },

  // --- Debt ----------------------------------------------------------------
  { catalogId: 'personal-loan', amount: 158_347, over: { loan_id: 'plan_loan_personal' } },
  { catalogId: 'lease', amount: 122_867, over: { loan_id: 'plan_loan_lease' } },
  /*
   * "Iphone 36,000 / 131,000" — a monthly instalment against a remaining
   * total, which is the sinking-fund shape: ~4 months to clear 131,000.
   */
  {
    catalogId: 'device-instalment',
    amount: 36_000,
    over: {
      name: 'iPhone instalment',
      plan_target_minor: minor(131_000),
      plan_start_date: NOW,
      plan_due_date: NOW + 120 * DAY,
    },
  },

  // --- Savings & goals -----------------------------------------------------
  /*
   * "need to save 500,000 / months need to save 2" -> 250,000 a month to top
   * the down payment up to 3,000,000.
   */
  {
    catalogId: 'vehicle-fund',
    amount: 250_000,
    over: {
      name: 'Down payment top-up',
      card_id: 'plan_card_downpayment',
      plan_target_minor: minor(500_000),
      plan_start_date: NOW,
      plan_due_date: NOW + 60 * DAY,
    },
  },
  // "Unexpected 20,000 / 55,000" — the month's slack, with a target reserve.
  {
    catalogId: 'buffer',
    amount: 20_000,
    over: { plan_target_minor: minor(55_000), plan_start_date: NOW },
  },
];

// ---------------------------------------------------------------------------
// Build rows from the plan
// ---------------------------------------------------------------------------

/** Catalog ids whose payments are per-property. Mirrors budget/logic/houses.ts. */
const HOUSE_SCOPED = new Set([
  'rent',
  'electricity',
  'water',
  'gas',
  'internet',
  'maintenance',
  'garbage',
  'domestic-help',
  'parents',
  'rent-income',
]);

/** Only the categories the plan actually uses, in catalog order. */
const usedCategoryIds = [...new Set(PLAN.map((p) => line(p.catalogId).category.id))];
const categoryOrder = [...CATALOG.categories.keys()];
usedCategoryIds.sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));

const categories = usedCategoryIds.map((cid, index) => {
  const cat = CATALOG.categories.get(cid);
  return {
    id: `plan_cat_${cid}`,
    name: cat.name,
    // Savings funds its own goal account; everything else draws on salary.
    card_id: cid === 'savings' ? 'plan_card_downpayment' : SALARY_CARD,
    color: cat.color,
    icon: cat.icon,
    due_day: 1,
    default_frequency: 'monthly',
    sort_order: index,
  };
});

const subcategories = PLAN.map((entry, index) => {
  const def = line(entry.catalogId);
  const over = entry.over ?? {};
  const scoped = HOUSE_SCOPED.has(entry.catalogId);

  return {
    // `key` disambiguates the one catalog line used twice (internet).
    id: `plan_sub_${entry.key ?? entry.catalogId}`,
    name: over.name ?? def.name,
    type: def.type,
    category_id: `plan_cat_${def.category.id}`,
    color: def.category.color,
    icon: over.icon ?? def.icon,
    planned_minor: minor(entry.amount),
    frequency: over.frequency ?? def.frequency,
    due_day: over.due_day ?? def.dueDay ?? null,
    card_id: over.card_id ?? null,
    once_in_period: null,
    loan_id: over.loan_id ?? null,
    house_scoped: scoped,
    house_id: scoped ? (over.house_id ?? null) : null,
    plan_target_minor: over.plan_target_minor ?? null,
    plan_due_date: over.plan_due_date ?? null,
    plan_start_date: over.plan_start_date ?? null,
    plan_remind_days_before: 14,
    sort_order: index,
    archived_at: null,
  };
});

// ---------------------------------------------------------------------------
// Assemble the snapshot
// ---------------------------------------------------------------------------

const tables = { cards, houses, loans, categories, incomes, subcategories };

const counts = Object.fromEntries(
  Object.entries(tables).map(([table, rows]) => [table, rows.length]),
);

/*
 * Which parts this snapshot holds, derived from the tables present rather than
 * hardcoded — the restore screen reads this to say what is inside BEFORE the
 * user commits, and a hand-written list goes stale the moment a table is added.
 * Mirrors BACKUP_PARTS in features/backup/logic/backup.ts.
 */
const PART_TABLES = {
  core: ['settings', 'cards'],
  plan: ['categories', 'subcategories', 'incomes'],
  houses: ['houses'],
  loans: ['loans'],
  vehicles: ['vehicles', 'vehicle_services', 'service_items'],
  rules: ['merchant_rules'],
  history: ['transactions', 'subcategory_states', 'category_states', 'fundings', 'fuel_entries'],
};

const present = new Set(Object.keys(tables));
const parts = Object.entries(PART_TABLES)
  .filter(([, ts]) => ts.some((t) => present.has(t)))
  .map(([key]) => key);

const snapshot = {
  version: 1,
  createdAt: new Date().toISOString(),
  appVersion: 'plan-import',
  label: 'My plan (from spreadsheet)',
  parts,
  counts,
  tables,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);

// --- Report, so the numbers can be checked against the sheet -----------------

const sum = (rows, pick) => rows.reduce((t, r) => t + pick(r), 0);
const lkr = (m) => `LKR ${(m / 100).toLocaleString('en-US')}`;
const inCat = (cid) => subcategories.filter((s) => s.category_id === `plan_cat_${cid}`);

const income = sum(
  incomes.filter((i) => i.is_active),
  (i) => i.amount_minor,
);
const debt = sum(
  subcategories.filter((s) => s.loan_id),
  (s) => s.planned_minor,
);
const savings = sum(inCat('savings'), (s) => s.planned_minor);
/*
 * House lines are excluded from the living total on purpose: they ACCUMULATE
 * the bills already counted above, so adding them would double-count. This is
 * the same rule the board applies.
 */
const houseLines = new Set(inCat('houses').map((s) => s.id));
const living = sum(
  subcategories.filter((s) => !s.loan_id && !houseLines.has(s.id) && !inCat('savings').includes(s)),
  (s) => s.planned_minor,
);

console.log(`Wrote ${OUT}\n`);
console.log(`  income (active)     ${lkr(income)}`);
console.log(`  living + running    ${lkr(living)}`);
console.log(`  loan instalments    ${lkr(debt)}`);
console.log(`  savings             ${lkr(savings)}`);
console.log(`  ---`);
console.log(`  remaining           ${lkr(income - living - debt - savings)}`);
console.log(`\n  loan % of income    ${((debt / income) * 100).toFixed(2)}%  (sheet: 37.50%)`);
console.log(
  `\n  categories: ${categories.length}  bills: ${subcategories.length}  ` +
    `(all from the shared catalog)`,
);
console.log(
  `  house budget lines  ${lkr(sum(inCat('houses'), (s) => s.planned_minor))} (accumulators, not added above)`,
);

/*
 * Deliberately not carried over
 * ----------------------------
 *   Doller rate 300              -> lives on the income row as foreign_rate.
 *   Vehicle plan A 13,550,000    -> the purchase price; the app tracks the
 *                                   financing and the down payment, not the
 *                                   sticker.
 *   Total interest figures       -> derived by the loan schedule from
 *                                   principal/rate/term; storing them would be
 *                                   a second source of truth that can drift.
 *   "Personal loan 2" (all zero) -> an empty what-if slot.
 *   "one time other charges",
 *   "Other income" (both 0)      -> unfilled placeholders.
 *   The ratio block at the bottom -> the app computes these live.
 *   4,272,802 "After vehicle expenses" -> does not reconcile with the monthly
 *                                   figures around it; flagged, not guessed.
 */
