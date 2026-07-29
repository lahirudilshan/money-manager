/**
 * Infer *what a transaction is for* from its SMS text — a semantic tag like
 * "water" or "electricity" — so the app can suggest the right bill instead of
 * relying on fuzzy text overlap alone.
 *
 * This is a keyword map, not a classifier: each tag lists the words that appear
 * in real Sri Lankan bank/utility alerts (see src/data/sms-samples.json for the
 * source strings). It is intentionally simple and pure so it is trivially
 * testable and easy to extend — add a keyword, add a test sample, done.
 *
 * A tag flows two ways:
 *   - reconcile ranks bills whose name/category share the tag higher;
 *   - the confirm UI pre-filters the bill suggestion list to the tag.
 */

/** The semantic buckets a transaction can fall into. */
export type CategoryHint =
  | 'water'
  | 'electricity'
  | 'telecom'
  | 'groceries'
  | 'fuel'
  | 'subscription'
  | 'loan'
  | 'transfer'
  | 'atm'
  | 'income';

/** Human label + icon for each hint, for chips and the filter UI. */
export const HINT_META: Record<CategoryHint, { label: string; icon: string }> = {
  water: { label: 'Water', icon: 'water-outline' },
  electricity: { label: 'Electricity', icon: 'flash-outline' },
  telecom: { label: 'Phone / Internet', icon: 'call-outline' },
  groceries: { label: 'Groceries', icon: 'cart-outline' },
  fuel: { label: 'Fuel', icon: 'car-outline' },
  subscription: { label: 'Subscription', icon: 'repeat-outline' },
  loan: { label: 'Loan', icon: 'trending-down-outline' },
  transfer: { label: 'Transfer', icon: 'swap-horizontal-outline' },
  atm: { label: 'ATM cash', icon: 'cash-outline' },
  income: { label: 'Income', icon: 'arrow-down-circle-outline' },
};

/**
 * Keyword patterns per tag, most specific first. Order within the list does not
 * matter, but the ORDER OF THE ENTRIES below is the tie-break priority when a
 * message matches more than one tag (e.g. an SMS naming both a merchant and a
 * card) — utilities and loans win over the broad "transfer"/"income" buckets.
 */
const HINT_KEYWORDS: [CategoryHint, RegExp[]][] = [
  [
    'water',
    [/\bwater\b/i, /\bnwsdb\b/i, /national water supply/i, /water board/i],
  ],
  [
    'electricity',
    [
      /\belectricity\b/i,
      /\bceb\b/i,
      /\bleco\b/i,
      /ceylon electricity/i,
      /electricity board/i,
    ],
  ],
  [
    'telecom',
    [
      /\bdialog\b/i,
      /\bmobitel\b/i,
      /\bhutch\b/i,
      /\bairtel\b/i,
      /\bslt\b/i,
      /axiata/i,
      /\breload\b/i,
      /\bpostpaid\b/i,
      /\bprepaid\b/i,
    ],
  ],
  [
    'groceries',
    [
      /\bkeells\b/i,
      /\bcargills\b/i,
      /\bfood city\b/i,
      /\barpico\b/i,
      /\bglomark\b/i,
      /\bsupermarket\b/i,
      /\bsuper\b/i,
      /\bfresh\b/i,
      /\bmart\b/i,
    ],
  ],
  [
    'fuel',
    [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bceypetco\b/i, /\bioc\b/i, /filling station/i],
  ],
  [
    'subscription',
    [
      /\bsubscription\b/i,
      /\bsub\b/i,
      /\bnetflix\b/i,
      /\bspotify\b/i,
      /\byoutube\b/i,
      /\banthropic\b/i,
      /\bclaude\b/i,
      /\bopenai\b/i,
      /\bgoogle\b/i,
      /\bicloud\b/i,
      /\bapple\.com\b/i,
    ],
  ],
  ['loan', [/\bloan\b/i, /\blease\b/i, /\binstal?ment\b/i, /Reason\s*:\s*MB:loan/i]],
  ['transfer', [/\btransfer\b/i, /\bcefts\b/i, /\bslips\b/i, /\bctb\b/i]],
  ['atm', [/\batm\b/i, /\bwithdrawal\b/i, /cash withdrawal/i]],
  ['income', [/\bsalary\b/i, /\bpayroll\b/i, /\bdividend\b/i, /\brefund\b/i]],
];

/**
 * Infer the single best category tag for a piece of SMS text (usually the
 * merchant plus the raw message), or null when nothing recognisable matches.
 * The first entry in HINT_KEYWORDS whose patterns hit wins, so utilities are
 * chosen ahead of the generic transfer bucket.
 */
export function inferCategoryHint(text: string): CategoryHint | null {
  if (!text) return null;
  for (const [hint, patterns] of HINT_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(text))) return hint;
  }
  return null;
}

/**
 * All tags a text matches, in priority order — used by the UI to offer a couple
 * of filter chips when a message is ambiguous (e.g. a supermarket that also
 * sells fuel). Empty when nothing matches.
 */
export function inferCategoryHints(text: string): CategoryHint[] {
  if (!text) return [];
  return HINT_KEYWORDS.filter(([, patterns]) => patterns.some((p) => p.test(text))).map(
    ([hint]) => hint,
  );
}

/**
 * Whether a bill (its name + category name) plausibly belongs to a tag, so the
 * suggestion list can be pre-filtered. Reuses the same keyword patterns against
 * the bill's own text — a bill literally called "Water" matches the water tag.
 */
export function billMatchesHint(hint: CategoryHint, billText: string): boolean {
  const patterns = HINT_KEYWORDS.find(([h]) => h === hint)?.[1] ?? [];
  return patterns.some((pattern) => pattern.test(billText));
}

/**
 * Named merchants worth seeding into the learned `merchant_rules` table, as
 * plain text keyed by the tag they imply.
 *
 * The keyword list above is regex and matches whole *messages*; the rules table
 * is plain text and matches *merchant names*. Only the entries that are real
 * merchant names cross over — generic words like "super" or "transfer" would
 * fire on far too much once containment matching is applied, so they stay
 * message-level keywords only.
 *
 * Seed rules carry no `subcategoryId` (the app cannot know which of the user's
 * lines to point at); they contribute the *hint*, and the moment the user
 * resolves a draft the rule is re-pointed at a real line and becomes 'learned'.
 */
export const SEED_MERCHANT_PATTERNS: [CategoryHint, string[]][] = [
  ['water', ['nwsdb', 'national water supply', 'water board']],
  ['electricity', ['ceb', 'leco', 'ceylon electricity']],
  ['telecom', ['dialog', 'mobitel', 'hutch', 'airtel', 'slt']],
  ['groceries', ['keells', 'cargills', 'food city', 'arpico', 'glomark', 'laughs']],
  ['fuel', ['ceypetco', 'ioc', 'filling station']],
  ['subscription', ['netflix', 'spotify', 'youtube', 'anthropic', 'openai', 'icloud']],
];
