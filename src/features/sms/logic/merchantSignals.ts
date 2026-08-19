/**
 * Read EVERYTHING a message says about what it was for, and score it.
 *
 * ## Why the old approach kept failing
 *
 * `inferCategoryHint` walks a keyword list and returns the FIRST tag that
 * matches, or null. Two consequences, both visible on the user's real queue
 * where 9 of 14 drafts matched nothing:
 *
 *   - a merchant the list has never heard of scores nothing at all, even when
 *     its NAME says exactly what it is. "NAWALOKA HOSPITALS", "A S P Pharmacy &
 *     Grocery" and "SPAR" are unmistakable to a human and invisible to a
 *     first-match keyword walk;
 *   - a first match wins outright, so "A S P Pharmacy & Grocery" — which names
 *     two categories — can never express that it is mostly a pharmacy.
 *
 * ## What this does instead
 *
 * Scores every candidate category against the WHOLE message rather than
 * stopping at the first hit, and weighs the evidence by where it appeared and
 * how specific it is:
 *
 *   - a known brand ("KEELLS", "NAWALOKA") beats a generic word;
 *   - a word in the MERCHANT field beats the same word in the message body,
 *     because bank boilerplate mentions all sorts of things;
 *   - a business-type suffix ("HOSPITALS", "PHARMACY", "SUPER") is strong,
 *     since that IS what the business is;
 *   - the transaction kind contributes (an ATM withdrawal is cash, whatever the
 *     merchant says).
 *
 * The result is ranked, so a message naming two categories reports both in
 * order, and the UI can offer the runner-up instead of nothing.
 *
 * Pure and data-driven: every rule is a row in the table below, and adding a
 * merchant is one line.
 */

import type { CategoryHint } from './smsCategoryHints';

/**
 * The categories a message can be scored against.
 *
 * Deliberately WIDER than `CategoryHint`, which only covers the buckets the
 * shared catalog votes on. Real spending includes hospitals, restaurants and
 * hardware shops; refusing to name them is why they matched nothing.
 */
export type SpendCategory =
  | CategoryHint
  | 'health'
  | 'dining'
  | 'clothing'
  | 'education'
  | 'transport'
  | 'entertainment'
  | 'household'
  | 'insurance';

/** One piece of evidence found in the message. */
export interface Signal {
  category: SpendCategory;
  /** What matched, for the "why this suggestion" line. */
  matched: string;
  weight: number;
  /**
   * Where in the merchant name it matched, or -1 when it came from the body.
   *
   * Position is real evidence, not a tiebreak of convenience. A business leads
   * its name with its main trade: "Pharmacy & Grocery" is a pharmacy that also
   * sells food, and "Grocery & Pharmacy" is the reverse. Without this the two
   * tie at an identical score and the winner is whichever category happens to
   * sit earlier in the table below — arbitrary, and wrong half the time.
   */
  at: number;
}

/** A ranked conclusion about what the transaction was for. */
export interface CategoryGuess {
  category: SpendCategory;
  /** 0-1. Above `SUGGEST_THRESHOLD` is worth showing. */
  score: number;
  /** The evidence behind it, strongest first. */
  reasons: string[];
}

/**
 * Named businesses, by category.
 *
 * A brand name is the strongest possible signal — "KEELLS" means groceries with
 * no ambiguity — so these outweigh every generic rule. Sri Lankan chains
 * dominate because that is where the user's messages come from, but nothing
 * here is region-locked: an unrecognised brand simply falls through to the
 * generic vocabulary below, which is the point of having both.
 */
const BRANDS: [SpendCategory, string[]][] = [
  ['groceries', ['keells', 'cargills', 'food city', 'arpico', 'glomark', 'laughs', 'spar', 'sathosa', 'softlogic glomark']],
  ['health', ['nawaloka', 'asiri', 'durdans', 'lanka hospital', 'hemas hospital', 'ninewells', 'oasis hospital', 'osu sala', 'healthguard', 'union chemists']],
  ['telecom', ['dialog', 'mobitel', 'hutch', 'airtel', 'slt', 'starlink', 'axiata']],
  ['fuel', ['ceypetco', 'ioc', 'sinopec', 'petroleum']],
  ['electricity', ['ceb', 'leco', 'ceylon electricity']],
  ['water', ['nwsdb', 'national water supply', 'water board']],
  /*
   * Food DELIVERY is listed before the ride-hailing brands below, and the
   * two-word forms are what make it work.
   *
   * "UBER EATS" and "PICKME FOOD" are the same companies as the taxi services,
   * so the bare brand matched `transport` and a food order was filed as a ride
   * — the user's real UBER EATS row scored transport 0.91 with nothing to
   * contest it. The full service name is the discriminator, and because both
   * are matched as phrases the longer one is the specific answer.
   *
   * This is the single biggest source of misfiled food spend: delivery is
   * ordered far more often than taxis for most people, and every order was
   * landing on the wrong line.
   */
  ['dining', [
    'uber eats', 'ubereats', 'pickme food', 'pickme foods', 'pick me food',
    'glovo', 'deliveroo', 'foodpanda', 'food panda', 'menulog', 'kapruka food',
    /*
     * Both forms of the possessive brands.
     *
     * Boundaries are matched on whole words (see `phraseIndex`, which protects
     * "spar" from firing inside "Sparrow"), so "mcdonald" does NOT match
     * "MCDONALDS" — the trailing s is a word character. Listing the plural is
     * the fix that keeps the boundary rule intact.
     */
    'pizza hut', 'kfc', 'mcdonald', 'mcdonalds', "mcdonald's",
    'burger king', 'dominos', "domino's",
    'subway', 'starbucks', 'popeyes', 'taco bell', 'dunkin',
    'barista', 'coffee bean', 'java lounge', 'chinese dragon', 'nihonbashi',
    'cinnamon', 'shangri', 'kingsbury', 'movenpick', 'galle face hotel',
  ]],
  ['clothing', ['odel', 'nolimit', 'no limit', 'fashion bug', 'cool planet', 'hameedia', 'kelly felder']],
  ['subscription', ['netflix', 'spotify', 'youtube', 'anthropic', 'openai', 'icloud', 'apple.com', 'google', 'microsoft', 'adobe']],
  ['entertainment', ['scope cinemas', 'savoy', 'liberty cinema', 'pvr']],
  ['household', ['singer', 'abans', 'damro', 'softlogic', 'hardware']],
  ['insurance', ['ceylinco', 'aia', 'allianz', 'sri lanka insurance', 'union assurance', 'janashakthi']],
  ['education', ['campus', 'college', 'institute', 'academy', 'university']],
];

/**
 * Generic business-type vocabulary.
 *
 * What a business CALLS itself is nearly as reliable as its brand — "HOSPITALS"
 * in a merchant name is not ambiguous — and it is what lets an unknown shop be
 * categorised at all. This is the layer the old keyword list was missing.
 */
const VOCABULARY: [SpendCategory, RegExp[]][] = [
  ['health', [
    /\bhospital/i, /\bpharmac/i, /\bmedical\b/i, /\bclinic\b/i, /\bdental\b/i,
    /\blab(?:orator)?(?:y|ies)\b/i, /\bmedi[-\s]?care\b/i, /\bnursing\b/i,
    /\bchemist/i, /\bdrug\s*store\b/i, /\bsurgery\b/i, /\bdoctor\b/i, /\bchannel/i,
  ]],
  ['groceries', [
    /\bsupermarket\b/i, /\bsuper\b/i, /\bgrocer/i,
    /*
     * A bare "food" means the grocery kind — a shop called FOODS, or a typed
     * "food expenses" — but NOT when the next word makes it restaurant food.
     *
     * Without the guard the generic word beats the specific phrase: "food
     * delivery" matched `food` at position 0 and took the lead-name bonus, so
     * groceries scored 0.91 against dining's 0.85 and a delivery order was
     * filed as a supermarket run. The lookahead is the cheapest correct fix —
     * it lets the more specific dining phrase win by simply declining to
     * compete.
     */
    /(?<!\boutside\s)\bfoods?\b(?!\s*(?:delivery|deliveries|court|panda))/i,
    /\bmart\b/i, /\bstores?\b/i, /\bfresh\b/i, /\bmarket\b/i, /\bprovision/i,
  ]],
  ['dining', [
    /\brestaurant\b/i, /\bcafe\b/i, /\bcoffee\b/i, /\bbakery\b/i, /\bpizza\b/i,
    /\bhotel\b/i, /\bresort\b/i, /\bkitchen\b/i, /\bdining\b/i, /\bbar\s*&?\s*grill\b/i,
    /*
     * The MEAL words, which matter most for a typed transfer reason.
     *
     * A user annotating their own transfer writes "dinner with family" or
     * "lunch", never "restaurant" — and those scored nothing at all, so the
     * transfer arrived with no category despite saying plainly what it was.
     * These are the outside-food counterpart to the grocery vocabulary below.
     *
     * "takeaway"/"delivery" are here rather than under groceries because food
     * brought to the door is restaurant food; it is eating out without the
     * travel, which is exactly the distinction the split has to get right.
     */
    /\bdinner\b/i, /\blunch\b/i, /\bbreakfast\b/i, /\bbrunch\b/i,
    /\beat(?:ing)?\s*out\b/i, /\btake\s*away\b/i, /\btakeout\b/i,
    /\bfood\s*delivery\b/i, /\boutside\s*food\b/i, /\bmeal\b/i, /\bbuffet\b/i, /\bcanteen\b/i,
    /\bhotel\s*food\b/i, /\bshort\s*eats?\b/i, /\bfast\s*food\b/i,
  ]],
  ['fuel', [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bfilling\s*station\b/i, /\bgas\s*station\b/i]],
  ['transport', [/\btaxi\b/i, /\buber\b/i, /\bpickme\b/i, /\brailway\b/i, /\bbus\b/i, /\bparking\b/i, /\btoll\b/i]],
  ['clothing', [/\bfashion\b/i, /\bapparel\b/i, /\bclothing\b/i, /\bgarment/i, /\bshoes?\b/i, /\btextile/i]],
  ['education', [/\bschool\b/i, /\btuition\b/i, /\beducation\b/i, /\bclasses\b/i, /\bcourse\b/i]],
  ['entertainment', [/\bcinema\b/i, /\btheatre\b/i, /\bmovie/i, /\bgaming\b/i]],
  ['household', [/\bfurniture\b/i, /\bhardware\b/i, /\belectronics\b/i, /\bappliance/i]],
  ['insurance', [/\binsurance\b/i, /\bassurance\b/i, /\bpolicy\s*(?:no|premium)\b/i, /\bpremium\b/i]],
  ['telecom', [/\binternet\b(?!\s*banking)/i, /\bbroadband\b/i, /\breload\b/i, /\bpostpaid\b/i, /\bprepaid\b/i]],
  ['subscription', [/\bsubscription\b/i, /\bstreaming\b/i, /\brenewal\b/i]],
  ['atm', [/\batm\b/i, /\bcash\s*withdrawal\b/i]],
  ['loan', [/\bloan\b/i, /\bleas(?:e|ing)\b/i, /\binstal{1,2}ment\b/i, /\bEMI\b/]],
];

/**
 * Weights, and why they are ordered this way.
 *
 * The gap between a brand and a generic word is deliberately wide: "NAWALOKA"
 * is proof, while "foods" appearing somewhere in a message is a hint. And the
 * same word is worth far more in the merchant field than in the body, because
 * bank boilerplate ("Protect from scams", branch names, hotline text) is full
 * of words that mean nothing about the purchase.
 */
const WEIGHT = {
  brandInMerchant: 1,
  brandInBody: 0.45,
  /*
   * A business-type word in the MERCHANT field is nearly proof.
   *
   * "BEN FOODS" and "A S P Pharmacy & Grocery" are not on any brand list and
   * never will be — there are too many shops — but what they call themselves
   * says exactly what they sell. Weighted at 0.6 these scored 0.30 after the
   * reconciler's 0.5 multiplier, just under the 0.4 bar, so a perfectly
   * readable merchant produced no suggestion. 0.85 keeps a brand ahead while
   * letting a self-describing name stand on its own.
   */
  vocabInMerchant: 0.85,
  vocabInBody: 0.2,
  /** The transaction kind — an ATM withdrawal is cash regardless of merchant. */
  kind: 0.7,
  /**
   * A bonus for the trade a business names FIRST.
   *
   * "A S P Pharmacy & Grocery" scores two identical `vocabInMerchant` hits, so
   * without this the two categories tie at 0.85 and the winner falls to a sort
   * tiebreak — health by a hair, groceries if anything nudges the order. A tie
   * is the wrong shape for this: the name is not ambiguous to a human, because
   * a shop leads with what it mainly is and appends what it also does.
   *
   * Small on purpose. It must separate two otherwise-equal generic words
   * without letting a leading generic word beat a known brand later in the
   * name — "CITY CAFE at KEELLS SUPER" is a KEELLS, not a cafe. At 0.06 the
   * lead trade clears its runner-up by a visible margin while staying far below
   * the 0.15 gap between `brandInMerchant` and `vocabInMerchant`.
   */
  leadsName: 0.06,
} as const;

/**
 * How far into a name still counts as "leading" it.
 *
 * "A S P Pharmacy" puts its trade at character 6, behind an initialism, and
 * plenty of shops open with "New", "Royal" or a founder's name. Thirty
 * characters covers those without letting the tail of a long name claim to lead
 * it.
 */
const LEAD_WINDOW = 30;

/** Above this, a guess is worth showing the user. */
export const SUGGEST_THRESHOLD = 0.4;

/**
 * Score what a message was for, best guess first.
 *
 * `merchant` is scored separately from `raw` rather than concatenated, because
 * where a word appears is most of what makes it trustworthy.
 */
export function guessCategories(input: {
  merchant: string;
  raw: string;
  kind?: string;
}): CategoryGuess[] {
  const merchant = input.merchant ?? '';
  const body = input.raw ?? '';

  const signals: Signal[] = [];

  for (const [category, names] of BRANDS) {
    for (const brand of names) {
      const brandAt = phraseIndex(merchant, brand);
      if (brandAt !== -1) {
        signals.push({ category, matched: brand, weight: WEIGHT.brandInMerchant, at: brandAt });
      } else if (containsPhrase(body, brand)) {
        signals.push({ category, matched: brand, weight: WEIGHT.brandInBody, at: -1 });
      }
    }
  }

  for (const [category, patterns] of VOCABULARY) {
    for (const pattern of patterns) {
      const inMerchant = pattern.exec(merchant);
      if (inMerchant) {
        signals.push({
          category,
          matched: inMerchant[0],
          weight: WEIGHT.vocabInMerchant,
          at: inMerchant.index,
        });
        continue;
      }

      const inBody = pattern.exec(body);
      if (inBody) {
        signals.push({ category, matched: inBody[0], weight: WEIGHT.vocabInBody, at: -1 });
      }
    }
  }

  /*
   * The transaction kind, which the merchant cannot contradict.
   *
   * An ATM withdrawal is cash even when the machine sits in a bank branch whose
   * name looks like something else — "DFCC bank" as a merchant is the ATM's
   * owner, not a purchase from a bank.
   */
  if (input.kind === 'atm') {
    signals.push({ category: 'atm', matched: 'ATM withdrawal', weight: WEIGHT.kind, at: -1 });
  }
  if (input.kind === 'loan_payment') {
    signals.push({ category: 'loan', matched: 'loan payment', weight: WEIGHT.kind, at: -1 });
  }
  /*
   * A bank charge is DECIDED, not merely weighted.
   *
   * The parser only reaches this kind when the message names a charge as the
   * transaction's own type, so there is nothing for merchant vocabulary to add
   * — and plenty for it to break. The ATM fee row is named after its parent
   * ("HNB ATM Withdrawal fee") so the user can tell what it belongs to, and
   * those borrowed words scored `atm` 0.91 against `bank_charge` 0.70: the fee
   * would have been suggested as cash, on the strength of a label chosen to
   * describe the withdrawal it came from.
   *
   * Returning early is the honest encoding of "the merchant cannot contradict
   * the kind", which the comment above already claims but the scoring did not
   * enforce.
   */
  if (input.kind === 'bank_charge') {
    return [{ category: 'bank_charge', score: 1, reasons: ['bank fee'] }];
  }

  return rank(signals);
}

/**
 * Collapse signals into ranked guesses.
 *
 * Scores are combined so several weak hints can add up — "A S P Pharmacy &
 * Grocery" names both a pharmacy and a grocery, and the pharmacy wins on the
 * merchant-field weighting rather than by arbitrary list order — but capped at
 * 1 so a merchant matching five synonyms cannot outrank a single exact brand.
 */
function rank(signals: readonly Signal[]): CategoryGuess[] {
  const totals = new Map<SpendCategory, { score: number; reasons: string[]; at: number }>();

  for (const signal of signals) {
    const entry = totals.get(signal.category) ?? { score: 0, reasons: [], at: Number.MAX_SAFE_INTEGER };
    entry.score = Math.min(1, entry.score + signal.weight);
    if (!entry.reasons.includes(signal.matched)) entry.reasons.push(signal.matched);

    // Earliest mention wins — see `Signal.at`. Body matches (-1) never
    // out-rank a merchant match, so they are pushed to the back instead.
    if (signal.at >= 0) entry.at = Math.min(entry.at, signal.at);

    totals.set(signal.category, entry);
  }

  /*
   * The earliest-named trade earns a small bonus, so word order shows up as a
   * real confidence gap rather than a silent tiebreak.
   *
   * Applied only to the category matched FURTHEST forward in the merchant
   * name, and only when something actually matched there — a message whose
   * evidence is all in the body has no lead trade to reward.
   */
  const leader = [...totals.entries()]
    .filter(([, entry]) => entry.at >= 0 && entry.at <= LEAD_WINDOW)
    .sort((a, b) => a[1].at - b[1].at)[0];

  return [...totals.entries()]
    .map(([category, entry]) => ({
      category,
      score:
        leader && leader[0] === category
          ? Math.min(1, entry.score + WEIGHT.leadsName)
          : entry.score,
      reasons: entry.reasons,
      at: entry.at,
    }))
    .sort((a, b) => {
      /*
       * Score first, POSITION second.
       *
       * "A S P Pharmacy & Grocery" matches both categories in the merchant
       * field at identical weight, so score alone leaves the winner to table
       * order — arbitrary, and wrong half the time. A business leads its name
       * with its main trade, so the earlier word is the better answer.
       *
       * Only applied to a genuine tie: a stronger signal elsewhere in the name
       * should still beat a weak one at the front.
       */
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      return a.at - b.at;
    })
    .map(({ category, score, reasons }) => ({ category, score, reasons }));
}

/** The single best guess, or null when nothing cleared the bar. */
export function bestCategory(input: {
  merchant: string;
  raw: string;
  kind?: string;
}): CategoryGuess | null {
  const [best] = guessCategories(input);
  return best && best.score >= SUGGEST_THRESHOLD ? best : null;
}

/**
 * Whole-phrase containment, case-insensitive.
 *
 * Not a bare `includes`: "ioc" would otherwise fire inside "Biology" and
 * "Associates", and "spar" inside "Sparrow". Boundaries are checked manually
 * rather than with `\b` so multi-word brands ("food city") still match.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  return phraseIndex(haystack, phrase) !== -1;
}

/**
 * Where a whole-word phrase starts, or -1.
 *
 * The position is the point: it is what lets "Pharmacy & Grocery" be told apart
 * from "Grocery & Pharmacy" when both score identically. Boundaries are checked
 * by hand rather than with `\b` so multi-word brands ("food city") still match,
 * and so "spar" cannot fire inside "Sparrow".
 */
function phraseIndex(haystack: string, phrase: string): number {
  const text = haystack.toLowerCase();
  const needle = phrase.toLowerCase();

  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return -1;

    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + needle.length] ?? '';

    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
}

function isWordChar(char: string): boolean {
  return char !== '' && /[a-z0-9]/i.test(char);
}

/**
 * Words a BILL might use for a category, so a guess can be matched to the
 * user's own line names.
 *
 * Mirrors the structure of `HINT_SELF_WORDS` in smsCategoryHints.ts but covers
 * the wider set. A guess is useless unless it can find the line it belongs to.
 */
export const CATEGORY_SELF_WORDS: Record<SpendCategory, RegExp[]> = {
  water: [/\bwater\b/i],
  electricity: [/\belectric(?:ity)?\b/i, /\bpower\b/i, /\bceb\b/i],
  telecom: [/\bphone\b/i, /\bmobile\b/i, /\binternet\b/i, /\bbroadband\b/i, /\btelecom\b/i],
  /*
   * The two food lines must not answer to each other's category.
   *
   * Both entries carried a bare `\bfood\b`, so "Groceries (home food)" and
   * "Eating out & delivery" each matched BOTH guesses — the two lines tied at
   * 0.50 and the winner fell to board order, which put a UBER EATS delivery on
   * the Groceries line while the hint said dining. Qualifying the word is what
   * makes the split resolvable: home food here, restaurant food below.
   */
  groceries: [/\bgrocer(?:y|ies)\b/i, /\bhome\s*food\b/i, /\bshopping\b/i, /\bsupermarket\b/i],
  fuel: [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bgas\b/i],
  subscription: [/\bsubscription(?:s)?\b/i, /\bstreaming\b/i],
  loan: [/\bloan(?:s)?\b/i, /\blease\b/i, /\bdebt\b/i, /\bcredit\b/i, /\binstal/i],
  transfer: [/\btransfer(?:s)?\b/i],
  atm: [/\batm\b/i, /\bcash\b/i, /\bwithdrawal\b/i, /\bpocket\b/i, /\bspending\b/i],
  income: [/\bsalary\b/i, /\bincome\b/i, /\bwage(?:s)?\b/i, /\bpay\b/i],
  bank_charge: [/\bbank\b[^.]{0,20}\b(?:charge|fee)/i, /\b(?:charge|fee)s?\b/i],
  health: [/\bhealth\b/i, /\bmedic/i, /\bhospital\b/i, /\bpharmac/i, /\bdoctor\b/i, /\bdental\b/i],
  // The outside-food half — "delivery"/"takeaway" so the line answers to this
  // category by every part of its name. See the groceries note above.
  dining: [
    /\bdining\b/i, /\beating\s*out\b/i, /\brestaurant\b/i, /\bcafe\b/i,
    /\bdelivery\b/i, /\btake\s*away\b/i, /\boutside\s*food\b/i,
  ],
  clothing: [/\bcloth/i, /\bapparel\b/i, /\bfashion\b/i, /\bshoes?\b/i],
  education: [/\bschool\b/i, /\btuition\b/i, /\beducation\b/i, /\bclasses\b/i, /\bkids?\b/i],
  transport: [/\btransport\b/i, /\btaxi\b/i, /\btravel\b/i, /\bbus\b/i, /\btrain\b/i, /\bparking\b/i],
  entertainment: [/\bentertainment\b/i, /\bcinema\b/i, /\bmovie/i, /\bhobb/i, /\bfun\b/i],
  // "home" must not swallow "Groceries (home food)".
  household: [/\bhousehold\b/i, /\bhome\b(?!\s*food)/i, /\bfurniture\b/i, /\brepairs?\b/i, /\bmaintenance\b/i],
  insurance: [/\binsurance\b/i, /\bassurance\b/i, /\bpolicy\b/i, /\bpremium\b/i],
};

/** Whether a budget line plausibly belongs to a guessed category. */
export function lineMatchesCategory(category: SpendCategory, lineText: string): boolean {
  return (CATEGORY_SELF_WORDS[category] ?? []).some((pattern) => pattern.test(lineText));
}
