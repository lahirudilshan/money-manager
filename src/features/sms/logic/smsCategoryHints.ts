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
  | 'bank_charge'
  /*
   * The wider categories the message SCORER can read.
   *
   * These have no keyword patterns below — nothing infers them from a word
   * list. They exist because `merchantSignals` reads a merchant name properly
   * and can conclude "hospital" or "restaurant", and without a tag to carry
   * that answer the conclusion had nowhere to go: the user's NAWALOKA rows
   * scored health at 1.00 and still showed "Needs a category", because the card
   * renders the hint and the hint was null.
   *
   * `HINT_TARGET` in hintCatalog.ts already maps every one of these onto a real
   * catalog line, so "create it for me" works for them the moment they can be
   * named here.
   */
  | 'health'
  | 'dining'
  | 'clothing'
  | 'education'
  | 'transport'
  | 'entertainment'
  | 'household'
  | 'insurance';

/**
 * Human label + icon for each hint, for chips and the filter UI.
 *
 * The labels are written to finish the sentence the card starts: "Looks like
 * ___". A bare noun reads as the substance rather than the transaction — "Looks
 * like Water" is a puddle, "Looks like Water bill" is something you pay — so
 * anything that arrives AS a bill says so.
 *
 * Deliberately not applied to everything. A supermarket run is not a
 * "Groceries bill" and a cash withdrawal is not an "ATM bill"; forcing the word
 * on those would trade one kind of wrong for another. The rule is what the
 * money actually was: a billed service says "bill", a purchase does not.
 */
export const HINT_META: Record<CategoryHint, { label: string; icon: string }> = {
  water: { label: 'Water bill', icon: 'water-outline' },
  electricity: { label: 'Electricity bill', icon: 'flash-outline' },
  telecom: { label: 'Phone / Internet bill', icon: 'call-outline' },
  groceries: { label: 'Groceries', icon: 'cart-outline' },
  fuel: { label: 'Fuel', icon: 'car-outline' },
  subscription: { label: 'Subscription', icon: 'repeat-outline' },
  loan: { label: 'Loan payment', icon: 'trending-down-outline' },
  transfer: { label: 'Transfer', icon: 'swap-horizontal-outline' },
  atm: { label: 'ATM cash', icon: 'cash-outline' },
  income: { label: 'Income', icon: 'arrow-down-circle-outline' },
  bank_charge: { label: 'Bank charge', icon: 'receipt-outline' },
  // A hospital visit or a pharmacy run is a PURCHASE, not a billed service —
  // "Health bill" would be wrong for the very rows this tag exists to catch.
  health: { label: 'Health & medicine', icon: 'medkit-outline' },
  dining: { label: 'Dining out', icon: 'restaurant-outline' },
  clothing: { label: 'Clothing', icon: 'shirt-outline' },
  education: { label: 'Education fees', icon: 'school-outline' },
  transport: { label: 'Transport', icon: 'bus-outline' },
  entertainment: { label: 'Entertainment', icon: 'film-outline' },
  household: { label: 'Household', icon: 'home-outline' },
  // The word a policy actually uses for its payment.
  insurance: { label: 'Insurance premium', icon: 'shield-checkmark-outline' },
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
  /*
   * Eating out, checked BEFORE groceries.
   *
   * Entry order is the tie-break when a message matches two tags (see the list
   * comment above), and these two overlap constantly: "UBER EATS" and "FOOD
   * CITY" both contain grocery-ish words. Delivery and restaurant names are the
   * more specific reading, so they get first refusal.
   *
   * "food city" stays under groceries below and is unaffected — it is matched
   * as a whole phrase there, and nothing here claims it.
   */
  [
    'dining',
    [
      /\buber\s*eats\b/i,
      /\bpick\s*me\s*food/i,
      /\bfood\s*panda\b/i,
      /\bfoodpanda\b/i,
      /\bglovo\b/i,
      /\bdeliveroo\b/i,
      /\brestaurant\b/i,
      /\bcafe\b/i,
      /\bbakery\b/i,
      /\bpizza\b/i,
      /\bkfc\b/i,
      /\bmcdonald/i,
      /\bburger\s*king\b/i,
      /\bdomino/i,
      /\bsubway\b/i,
      /\bstarbucks\b/i,
      /\bdinner\b/i,
      /\blunch\b/i,
      /\bbreakfast\b/i,
      /\beat(?:ing)?\s*out\b/i,
      /\btake\s*away\b/i,
      /\bfood\s*delivery\b/i,
      /\bshort\s*eats?\b/i,
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
      /\bdistrokid\b/i,
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
  /*
   * Health, BEFORE `atm` and `groceries`.
   *
   * Two reasons for the position. NDB prints "ATM POS Transaction" on a card
   * payment, so the atm rule below claimed a 1,124.20 purchase at a chemist and
   * labelled it "ATM cash". And a shop called "Pharmacy & Grocery" contains the
   * word grocery, so the groceries rule would take it — but someone at a
   * chemist's counter is buying medicine, and the pharmacy word is the more
   * specific signal.
   *
   * `health` already existed as a tag with these words in HINT_SELF_WORDS,
   * which matches BILL NAMES. Nothing matched them in a MESSAGE, so every
   * pharmacy and hospital payment arrived with no suggestion at all.
   */
  [
    'health',
    [
      /\bpharmac/i,
      /\bchemist/i,
      /\bhospital\b/i,
      /\bmedical\b/i,
      /\bmedicine\b/i,
      /\bclinic\b/i,
      /\bdental\b/i,
      /\bnawaloka\b/i,
      /\basiri\b/i,
      /\bdurdans\b/i,
      /\blanka\s+hospital/i,
    ],
  ],
  /*
   * Getting about, AFTER `fuel` so a filling station keeps its own tag.
   *
   * `transport` was declared as a tag and had no patterns anywhere, so a
   * railway ticket in the user's history matched nothing at all and the card
   * said "Needs a category" on a message that plainly says RAILWAY.
   */
  [
    'transport',
    [
      /\brailway\b/i,
      /\bpickme\b/i,
      /\buber\b/i,
      /\btaxi\b/i,
      /\bbus\s+(?:ticket|fare|pass)\b/i,
      /\btrain\s+(?:ticket|fare)\b/i,
      /\bparking\b/i,
      /\btoll\b/i,
    ],
  ],
  /*
   * ATM, unless the message's SUBJECT is a fee.
   *
   * "debited ... as ATM Withdrawal Fee" is a charge that merely happens to name
   * a machine; it was read as a cash withdrawal and offered as pocket money.
   * The `as <something> Fee` construction names what the debit IS, which an
   * e-receipt itemising "Txn Fee: 30.00" inside a withdrawal does not — so the
   * receipt case below still resolves to `atm`.
   */
  [
    'atm',
    [/\batm\b/i, /\bwithdrawal\b/i, /cash withdrawal/i],
  ],
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
      /\b(?:transfer|txn|transaction|service|handling|processing|annual|monthly|late|overdraft|atm)\s+(?:\w+\s+)?(?:charge|charges|fee|fees)\b/i,
      /\bstamp\s+duty\b/i,
      /\bcommission\b/i,
      /\bcharges?\s*(?:applied|debited)\b/i,
    ],
  ],
  ['transfer', [/\btransfer\b/i, /\bcefts\b/i, /\bslips\b/i, /\bctb\b/i]],
  ['income', [/\bsalary\b/i, /\bpayroll\b/i, /\bdividend\b/i, /\brefund\b/i]],
];

/**
 * Infer the single best category tag for a piece of SMS text.
 *
 * ## Why this scores rather than taking the first match
 *
 * This used to return the first entry in `HINT_KEYWORDS` whose pattern hit,
 * which made correctness a property of LIST ORDER. Every new keyword risked
 * shadowing one below it, and the failure was silent: "debited ... as ATM
 * Withdrawal Fee" matched the one-word `/\batm\b/` before it ever reached the
 * fee patterns, so a 30-rupee bank charge was offered to the user as pocket
 * money. Fixing that by shuffling the list would only move the problem to
 * whichever rule ended up underneath.
 *
 * So the winner is the most SPECIFIC match instead. A pattern that matches
 * "ATM Withdrawal Fee" — eighteen characters of agreement with the message —
 * beats one matching the three letters of "ATM", whatever order they are
 * declared in. That is the same judgement a person makes reading the message:
 * the longer phrase says more.
 *
 * List order survives only as the tiebreak, so existing deliberate precedence
 * (utilities ahead of the generic transfer bucket) still holds when two rules
 * match equally well.
 */
export function inferCategoryHint(text: string): CategoryHint | null {
  if (!text) return null;

  let best: CategoryHint | null = null;
  let bestScore = 0;

  for (const [hint, patterns] of HINT_KEYWORDS) {
    const score = specificity(text, patterns);
    // Strictly greater, so an earlier entry wins a tie — see above.
    if (score > bestScore) {
      bestScore = score;
      best = hint;
    }
  }

  return best;
}

/**
 * How well a rule matches: the length of the longest substring it claims.
 *
 * Zero when nothing matches. Length is a crude proxy for specificity, but it is
 * the right one here: these patterns are phrases, and a longer agreement with
 * the message genuinely is stronger evidence than a shorter one. Anything more
 * elaborate — weights per rule, hand-tuned scores — would be another table to
 * keep in step with two files and a server.
 */
function specificity(text: string, patterns: readonly RegExp[]): number {
  let longest = 0;
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found && found[0].length > longest) longest = found[0].length;
  }
  return longest;
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
  /*
   * "food" here must mean the AT-HOME kind.
   *
   * These patterns match a BILL's own name, and the two food lines are now
   * "Groceries (home food)" and "Eating out & delivery" — so a bare `\bfood\b`
   * made the Groceries line answer to the `dining` hint as well, and a delivery
   * order was scored against groceries and filed there. The qualifier is what
   * keeps the two lines distinguishable by name.
   */
  groceries: [/\bgrocer(?:y|ies)\b/i, /\bhome\s*food\b/i, /\bshopping\b/i],
  fuel: [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bgas\b/i],
  subscription: [/\bsubscription(?:s)?\b/i, /\bstreaming\b/i],
  loan: [/\bloan(?:s)?\b/i, /\blease\b/i, /\bdebt\b/i, /\bcredit\b/i],
  transfer: [/\btransfer(?:s)?\b/i, /\bcash\b/i],
  atm: [/\batm\b/i, /\bcash\b/i, /\bwithdrawal\b/i],
  income: [/\bsalary\b/i, /\bincome\b/i, /\bwage(?:s)?\b/i, /\bpay\b/i],
  bank_charge: [/\bbank\b/i, /\bcharge(?:s)?\b/i, /\bfee(?:s)?\b/i, /\bduty\b/i],
  /*
   * The wider tags, named as a BILL LINE would name itself.
   *
   * These are what let a health-tagged message find the user's existing
   * "Medicine" or "Doctor" line instead of proposing a new one — the same job
   * the entries above do, for the categories the scorer can now detect.
   */
  health: [/\bhealth\b/i, /\bmedic(?:al|ine)\b/i, /\bdoctor\b/i, /\bhospital\b/i, /\bpharmac/i],
  // "delivery" and "takeaway" so the "Eating out & delivery" line answers to
  // this tag by every part of its name, not only the first two words.
  dining: [
    /\bdining\b/i, /\brestaurant\b/i, /\beat(?:ing)?\s*out\b/i, /\bcafe\b/i,
    /\bdelivery\b/i, /\btake\s*away\b/i,
  ],
  clothing: [/\bcloth(?:es|ing)\b/i, /\bapparel\b/i, /\bfashion\b/i],
  education: [/\beducation\b/i, /\btuition\b/i, /\bschool\b/i, /\bclasses\b/i],
  transport: [/\btransport\b/i, /\btaxi\b/i, /\bbus\b/i, /\btravel\b/i],
  entertainment: [/\bentertainment\b/i, /\bcinema\b/i, /\bmovies?\b/i, /\bleisure\b/i],
  /*
   * "home" must not swallow "Groceries (home food)".
   *
   * The lookahead is what keeps the grocery line out of the household tag now
   * that its name carries the home/outside qualifier — a supermarket run would
   * otherwise be proposed against Household items, which is the same mistake
   * ATM cash used to make.
   */
  household: [/\bhousehold\b/i, /\bhome\b(?!\s*food)/i, /\bfurniture\b/i, /\bappliance/i],
  insurance: [/\binsurance\b/i, /\bassurance\b/i, /\bpremium\b/i],
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
  ['subscription', ['netflix', 'spotify', 'youtube', 'anthropic', 'openai', 'icloud', 'distrokid']],
  ['transport', ['railway', 'pickme', 'uber']],
  ['health', ['pharmacy', 'nawaloka', 'asiri', 'durdans', 'hemas hospital']],
];
