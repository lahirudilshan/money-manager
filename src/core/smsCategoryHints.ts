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
  | 'income'
  /**
   * A fee the bank charged — CEFTS transfer charges, stamp duty, ATM fees.
   *
   * Its own tag rather than folded into `transfer`, because "CEFTS Transfer
   * Charges" contains the word Transfer and would otherwise be proposed against
   * the user's real transfer lines. Every fee belongs on one shared line.
   */
  | 'bank_charge';

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
  bank_charge: { label: 'Bank charge', icon: 'receipt-outline' },
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
      /\bstarlink\b/i,
      /axiata/i,
      /\breload\b/i,
      /\bpostpaid\b/i,
      /\bprepaid\b/i,
      /*
       * The service words, not just the provider names.
       *
       * These live in HINT_SELF_WORDS too, but that list only matches a BILL's
       * own name — so a message reading "STARLINK INTERNET" matched nothing at
       * all, because no provider pattern above knew the brand and `internet`
       * was not a message-level keyword anywhere. Any biller the list has never
       * heard of is still recognisable when it names the service it sells,
       * which is what these two cover.
       *
       * `internet` must NOT match "internet banking", which is how a great many
       * banks describe the CHANNEL a transfer went through — "Transfer via
       * Internet Banking" is a transfer, and a grocery bought online is still
       * groceries. Without the guard this keyword hijacked both, turning a
       * broad improvement into a broad regression.
       */
      /\binternet\b(?!\s*banking\b)/i,
      /\bbroadband\b/i,
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
  ['loan', [/\bloan\b/i, /\blease\b/i, /\binstal{1,2}ment\b/i, /Reason\s*:\s*MB:loan/i]],
  /*
   * ATM before fees, mirroring `classifyKind` in smsParser.ts.
   *
   * An ATM e-receipt itemises its own "Txn Fee: 30.00LKR", so testing for fee
   * wording first tagged every cash withdrawal as a bank charge. The fee is a
   * line item inside the receipt; the transaction is the withdrawal.
   */
  ['atm', [/\batm\b/i, /\bwithdrawal\b/i, /cash withdrawal/i]],
  /*
   * Bank fees, AFTER `atm` but BEFORE `transfer` — both placements matter.
   *
   * "CEFTS Transfer Charges" matches the transfer rule too, and whichever tag
   * wins decides which line the app proposes; a 25-rupee fee must never be
   * offered against the user's real transfer lines, so the more specific rule
   * is tried first. It sits after `atm` because an ATM e-receipt itemises its
   * own "Txn Fee: 30.00LKR" — the fee is a line item inside the receipt, and
   * the transaction is the withdrawal.
   */
  [
    'bank_charge',
    [
      /\b(?:transfer|txn|transaction|service|handling|processing|annual|monthly|late|overdraft|atm)\s+(?:charge|charges|fee|fees)\b/i,
      /\bstamp\s+duty\b/i,
      /\bcommission\b/i,
      /\bcharges?\s*(?:applied|debited)\b/i,
    ],
  ],
  ['transfer', [/\btransfer\b/i, /\bcefts\b/i, /\bslips\b/i, /\bctb\b/i]],
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
 * Words a BILL may use to name a tag's own category.
 *
 * HINT_KEYWORDS is tuned to recognise MESSAGES, where the useful signals are
 * merchant and biller names. Bills are named the other way round — after the
 * category — and several tags had no pattern for their own name, so a bill
 * called "Groceries" did not match the groceries tag while "Electricity"
 * matched electricity purely because that word appears in both roles.
 *
 * Mirrors HINT_SELF_WORDS in server/lib/hints.ts; the server owns detection now
 * and this is the offline fallback, so the two must agree or a message would be
 * categorised differently depending on whether the network was up.
 */
const HINT_SELF_WORDS: Record<CategoryHint, RegExp[]> = {
  water: [/\bwater\b/i],
  electricity: [/\belectric(?:ity)?\b/i, /\bpower\b/i],
  telecom: [/\bphone\b/i, /\bmobile\b/i, /\binternet\b/i, /\bbroadband\b/i, /\btelecom\b/i],
  groceries: [/\bgrocer(?:y|ies)\b/i, /\bfood\b/i, /\bshopping\b/i],
  fuel: [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bgas\b/i],
  subscription: [/\bsubscription(?:s)?\b/i, /\bstreaming\b/i],
  loan: [/\bloan(?:s)?\b/i, /\blease\b/i, /\bdebt\b/i, /\bcredit\b/i],
  transfer: [/\btransfer(?:s)?\b/i, /\bcash\b/i],
  atm: [/\batm\b/i, /\bcash\b/i, /\bwithdrawal\b/i],
  income: [/\bsalary\b/i, /\bincome\b/i, /\bwage(?:s)?\b/i, /\bpay\b/i],
  bank_charge: [/\bbank\b/i, /\bcharge(?:s)?\b/i, /\bfee(?:s)?\b/i, /\bduty\b/i],
};

/**
 * Whether a bill (its name + category name) plausibly belongs to a tag, so the
 * suggestion list can be pre-filtered.
 *
 * Two ways to match: the message keywords, so a hand-named "CEB bill" is
 * recognised as electricity, and the category's own names, so a plainly-named
 * "Groceries" is too.
 */
export function billMatchesHint(hint: CategoryHint, billText: string): boolean {
  const patterns = HINT_KEYWORDS.find(([h]) => h === hint)?.[1] ?? [];
  if (patterns.some((pattern) => pattern.test(billText))) return true;

  return HINT_SELF_WORDS[hint].some((pattern) => pattern.test(billText));
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
  ['telecom', ['dialog', 'mobitel', 'hutch', 'airtel', 'slt', 'starlink']],
  ['groceries', ['keells', 'cargills', 'food city', 'arpico', 'glomark', 'laughs']],
  ['fuel', ['ceypetco', 'ioc', 'filling station']],
  ['subscription', ['netflix', 'spotify', 'youtube', 'anthropic', 'openai', 'icloud']],
];
