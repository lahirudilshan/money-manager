/**
 * Match a parsed SMS onto the funding board.
 *
 * The board is not a ledger — a spend is recorded as "this bill (subcategory)
 * got paid this month". So reconciliation's job is to guess *which bill* a
 * message is about, from its merchant/description and amount, and hand back a
 * draft the user confirms. It never writes anything; it only proposes.
 *
 * Pure and board-shaped: it takes plain arrays (not the store) so it is unit
 * testable and the store can call it after any refresh.
 */

import { isMatchableAccount, parentReceiptOf, type ParsedSms } from './smsParser';
import { resolveCardId } from './planning';
import { billMatchesHint, inferCategoryHint, type CategoryHint } from './smsCategoryHints';
import {
  guessCategories,
  lineMatchesCategory,
  SUGGEST_THRESHOLD,
  type CategoryGuess,
} from './merchantSignals';
import { matchMerchant, type MatchConfidence, type MerchantRule } from './merchantRules';
import type { CatalogSuggestion } from './catalogSync';
import type { Minor } from './money';


/** The minimum a leaf's plan/actual and the SMS must be within to count as an
 * amount match, as a fraction — utilities vary month to month. */
const AMOUNT_TOLERANCE = 0.15;

/**
 * How steeply a runner-up category is discounted per point it lost by.
 *
 * At 4, the 0.06 gap between "A S P Pharmacy & Grocery"'s health (0.91) and
 * groceries (0.85) costs the grocery reading ~24% of its score — enough to drop
 * the match below the confident-match bar so the user is ASKED, rather than
 * having a pharmacy visit filed under Groceries. A genuine near-tie (a 0.01
 * gap) is left almost untouched, and a distant also-ran scores nearly nothing.
 */
const RUNNER_UP_DISCOUNT = 4;

/**
 * Fall back to what the message SCORER concluded when no keyword matched.
 *
 * `inferCategoryHint` is a fixed keyword list that never learned health,
 * dining, clothing or the rest, so it returned null for merchants that are
 * unmistakable to a human. The user's real queue is the proof: three NAWALOKA
 * rows and an "A S P Pharmacy & Grocery" scored `health` at 1.00 and 0.91
 * respectively, while the card — which renders the HINT — showed "Needs a
 * category" on all four. The app had the answer and refused to say it.
 *
 * Only consulted when the keyword walk finds nothing, so every existing
 * mapping keeps its exact behaviour and this can only fill in blanks.
 */
function hintFromGuesses(guesses: readonly CategoryGuess[]): CategoryHint | null {
  const [best] = guesses;
  if (!best || best.score < SUGGEST_THRESHOLD) return null;

  /*
   * `SpendCategory` is a superset of `CategoryHint` by construction — every
   * category the scorer can name is now a hint (see smsCategoryHints.ts) — so
   * this is a widening, not a guess.
   */
  return best.category as CategoryHint;
}

/**
 * The message with the bank's own CHANNEL heading removed.
 *
 * "HNB SMS ALERT:INTERNET, ... Location:UBER EATS" says the payment was made
 * online — "INTERNET" is how the card was used, not what was bought. But it is
 * also a telecom keyword, and the keyword walk runs over the whole message and
 * returns the first tag it finds, so every card-not-present purchase was
 * labelled a phone bill: the user's UBER EATS order came back as `telecom`
 * while the merchant scorer had correctly read `transport` from "UBER".
 *
 * The heading is dropped only from the text used for CATEGORY guessing. It stays
 * in `raw` everywhere else, since the parser reads the same label to decide the
 * transaction's direction and kind.
 */
function withoutChannelHeading(raw: string): string {
  return raw.replace(/\bSMS\s+ALERT\s*:?\s*[A-Z][A-Z\s/&-]{1,24}?\s*(?=,)/i, ' ');
}

/**
 * The LAST resort: the best guess the scorer had, even below the suggest bar.
 *
 * Everything above this asks "is this good enough to be confident". This asks a
 * different and much weaker question — "did the message contain a category word
 * at all" — and it runs only when every stronger reading has come back empty.
 *
 * The trade is deliberate and one-directional. The alternative to a weak guess
 * here is not a better guess, it is "Need a category": the user categorises by
 * hand from nothing. A weak suggestion they can see and correct in one tap is
 * strictly more useful than no suggestion, because both cost a tap when wrong
 * and only one of them can be right.
 *
 * What protects this from being noise is WHERE it sits. A confident guess has
 * already won, so this can never override a good answer — it can only fill a
 * blank. And it still requires the scorer to have found something: a message
 * with no category vocabulary anywhere yields null and the card honestly says
 * it does not know.
 *
 * The suggestion is NOT auto-filed. It reaches the card as a hint with
 * `unknown` confidence, so the user is still asked — see `confidence` below,
 * which only a learned rule can raise.
 */
function weakHintFromGuesses(guesses: readonly CategoryGuess[]): CategoryHint | null {
  const [best] = guesses;
  if (!best || best.score <= 0) return null;

  return best.category as CategoryHint;
}

/** A candidate bill the SMS might be about, with why we think so. */
export interface DraftMatch {
  subcategoryId: string;
  /** 0-1; higher is a more confident guess. Drives ordering and auto-select. */
  score: number;
}

/**
 * A proposed transaction awaiting the user's Yes / Edit / No. Everything here
 * is editable in the confirm card before it is logged; `subcategoryId` may be
 * empty when nothing matched, in which case the user must pick a bill.
 */
export interface SmsDraft {
  /** Stable id for the queue (dedupe + list keys). */
  id: string;
  parsed: ParsedSms;
  /**
   * What the SMS looks like it was *for* (water, electricity, groceries…),
   * inferred from its text. Drives the pre-filtered suggestion list and the
   * chip shown on the row. Null when nothing recognisable matched.
   */
  hint: CategoryHint | null;
  /** Best guess of the bill this is about; '' when none was confident enough. */
  subcategoryId: string;
  /**
   * Amount to log, in minor units of the **home currency** — converted from the
   * message's currency when it stated a foreign one (see `convertToHomeMinor`).
   * This is what the board records.
   */
  amountMinor: Minor;
  /**
   * Set only when the message was in a currency other than the user's, so the
   * review UI can say "USD 2,500.00 → Rs 750,000.00" rather than presenting a
   * converted figure the user cannot reconcile against the SMS they just read.
   * Null on ordinary same-currency alerts.
   */
  foreign: { currency: string; amountMinor: Minor } | null;
  /** Ranked alternatives for the "pick a different bill" dropdown. */
  matches: DraftMatch[];
  /**
   * How sure we are of `subcategoryId`, which decides what the review UI
   * offers: `exact` means a learned rule recognised this merchant outright and
   * the user need only tap Yes; `likely` is a guess worth showing; `unknown`
   * means the user must choose (and that choice is what teaches the system).
   */
  confidence: MatchConfidence;
  /**
   * Ranked category suggestions from the shared catalog, best first, at most
   * three. Empty when the catalog is off, unreachable, or knows this merchant.
   *
   * Kept separate from `hint` rather than collapsed into it: `hint` is what the
   * device concluded and drives matching, while these are what the CROWD
   * thinks, with confidences the detail sheet shows. Merging them would lose
   * the alternatives the user is meant to be able to pick from.
   */
  suggestions: CatalogSuggestion[];
  /**
   * What the message looks like it was for, read from EVERYTHING it says.
   *
   * Wider than `hint`, which only names the ten buckets the shared catalog
   * votes on. This is what lets a hospital or a restaurant be recognised at
   * all — and when the user has no matching line, what the UI offers to create.
   * Empty when the message named nothing recognisable.
   */
  guesses: CategoryGuess[];
  /** When the draft was created, for ordering the queue newest-first. */
  createdAt: number;
}

/**
 * Convert an SMS amount into the user's home currency.
 *
 * A foreign-currency alert states what the *bank* moved — "credited with
 * USD2,500.00" — but every plan, bill and total on the board is in the home
 * currency. Logging 2,500 against an LKR plan would understate a salary by
 * ~300x, and scoring it against LKR planned amounts would match nothing. So the
 * figure is converted once, here, and the original is kept on the draft so the
 * review UI can still show what the message actually said.
 *
 * `usdRate` is the app's single stored rate (home currency per 1 USD), so USD
 * converts exactly and any other foreign code cannot be converted without a rate
 * the app does not hold — those pass through unchanged rather than being
 * silently multiplied by the wrong number.
 */
export function convertToHomeMinor(
  amountMinor: Minor,
  currency: string | null,
  homeCurrency: string,
  usdRate: number,
): Minor {
  // No code stated, or already the home currency — nothing to convert.
  if (!currency || currency === homeCurrency) return amountMinor;
  if (!Number.isFinite(usdRate) || usdRate <= 0) return amountMinor;

  // The one rate the app stores is USD → home, so that is the one pair it can
  // convert. Anything else is left as-is for the user to correct on the draft.
  if (currency === 'USD') return Math.round(amountMinor * usdRate);
  if (homeCurrency === 'USD') return amountMinor;

  return amountMinor;
}

/** The board slices the reconciler needs — a subset of the store's arrays. */
export interface BoardSlice {
  subcategories: readonly {
    id: string;
    name: string;
    type: 'income' | 'expense';
    plannedMinor: Minor;
    categoryId: string;
    cardId: string | null;
    /**
     * Set when this line is a loan installment — targets loan-payment SMS, and
     * marks the line as a fixed commitment for exact-amount matching.
     */
    loanId: string | null;
  }[];
  categories: readonly { id: string; name: string; cardId: string | null }[];
  cards: readonly { id: string; name: string; last4: string | null; bankName: string | null }[];
}

/** The card an SMS's account digits point at, if any card matches its last-4. */
export function cardForAccount(
  account: string,
  cards: BoardSlice['cards'],
): BoardSlice['cards'][number] | undefined {
  // A fragment shorter than a last-4 cannot identify a card — "50" from HNB's
  // "Ac No:13802XXXXX50" would `endsWith`-match any account ending in 50. See
  // `isMatchableAccount`.
  if (!isMatchableAccount(account)) return undefined;
  return cards.find((card) => card.last4 && account.endsWith(card.last4));
}

/**
 * How to label the account an SMS came from, for the review UI.
 *
 * A recognised account is named in full — "HNB Salary ••4150" — because knowing
 * the message hit a real account of the user's is the strongest cheap signal that
 * the draft is genuinely theirs. The bank is prefixed only when recorded and not
 * already the start of the name, so a card the user called "HNB Current" does not
 * come out as "HNB HNB Current".
 *
 * With no match, the bare "••4150" is returned: it is all the message told us and
 * guessing further would be dishonest. Returns '' when there were no digits.
 */
export function accountLabelFor(account: string, cards: BoardSlice['cards']): string {
  const card = cardForAccount(account, cards);
  if (!card) return account ? `••${account}` : '';

  const bank =
    card.bankName && !card.name.toLowerCase().startsWith(card.bankName.toLowerCase())
      ? card.bankName
      : '';

  return [bank, card.name, card.last4 ? `••${card.last4}` : ''].filter(Boolean).join(' ');
}

/**
 * Whether a budget line is the one bank fees belong on.
 *
 * Matched on NAME rather than a stored id so the user's own "Bank Charges" or
 * "Bank fees" line is adopted instead of a duplicate appearing beside it, and
 * so renaming ours does not orphan every future fee.
 */
export function isBankChargeLine(billText: string): boolean {
  return /\bbank\b[^.]{0,20}\b(?:charge|charges|fee|fees)\b|\b(?:charge|charges|fee|fees)\b[^.]{0,20}\bbank\b/i.test(
    billText,
  );
}

/** Lowercase, strip punctuation, collapse spaces — for fuzzy text comparison. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Overlap between two phrases as the share of the shorter one's words that
 * appear in the longer. "ceb electricity" vs "electricity bill" -> 0.5. Cheap,
 * good enough to rank a handful of bills, and needs no NLP dependency.
 */
function textScore(a: string, b: string): number {
  const wordsA = normalise(a).split(' ').filter(Boolean);
  const wordsB = normalise(b).split(' ').filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setB = new Set(wordsB);
  const shared = wordsA.filter((word) => setB.has(word)).length;
  return shared / Math.min(wordsA.length, wordsB.length);
}

/** 1 when the amounts are within tolerance, tapering to 0 as they diverge. */
function amountScore(a: Minor, b: Minor): number {
  if (a <= 0 || b <= 0) return 0;
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff > AMOUNT_TOLERANCE) return 0;
  return 1 - diff / AMOUNT_TOLERANCE;
}

/**
 * Lines whose planned amount is a FIXED commitment, not an estimate.
 *
 * The distinction is what makes an exact amount match meaningful. A utility's
 * planned figure is a guess that drifts every month, so a bill landing on it to
 * the cent is coincidence. A loan installment or a subscription is contractually
 * the same number every time, so the same coincidence is near-proof — the bank
 * is debiting exactly what that line exists to pay.
 *
 * Read off the line's own linkage and naming rather than a user-set flag: a
 * `loanId` is definitive, and the lease/rental/instalment vocabulary covers the
 * fixed commitments the loan table does not model.
 */
export function isFixedCommitment(sub: BoardSlice['subcategories'][number]): boolean {
  // A loan-linked line is an installment by construction — the same figure
  // every month — which is exactly what makes an exact amount match evidence
  // rather than coincidence. See `isFixedAmount` in db/schema.ts.
  if (sub.loanId !== null) return true;

  /*
   * A line NAMED as a lease/loan/instalment counts too, even with no `loanId`.
   *
   * The loan table is opt-in: plenty of people add "Vehicle lease" as an
   * ordinary monthly bill and never fill in the amortisation screen. Their
   * lease debit is just as contractually fixed as a linked one, so refusing to
   * treat it as such meant the exact-amount evidence was thrown away precisely
   * for the users who track leases most simply.
   *
   * Matched on the line's own name, and kept to vocabulary that genuinely
   * implies a fixed contractual sum — a "subscription" is not here, because
   * those change price and a coincidental match would be weak evidence.
   */
  return FIXED_COMMITMENT_NAMES.test(sub.name);
}

/** Line names that imply a contractually fixed monthly sum. */
const FIXED_COMMITMENT_NAMES =
  /\b(?:lease|leasing|loan|instal{1,2}ment|emi|mortgage|rental|hire\s*purchase|premium)\b/i;

/**
 * Whether the SMS named anything the board could reason about.
 *
 * A message-level test, not a per-line one, and that distinction is the whole
 * point: the exact-amount bonus must be suppressed when the message identified
 * itself — even if it identified itself as something this particular line is
 * not. "Debited at KEELLS" names a merchant, so a lease line has no business
 * claiming it on amount alone, but every per-line signal against that lease line
 * is zero, so only asking the message can tell the two situations apart.
 *
 * A hint counts, and so does a merchant string with real letters in it — some
 * banks put a reference number where the merchant goes, which names nothing.
 */
function messageNamesSomething(parsed: ParsedSms, hint: CategoryHint | null): boolean {
  /*
   * A GENERIC transaction-type label names nothing.
   *
   * "Transfer Out", "CEFTS Outward Transfer" and friends are the bank's word
   * for the mechanism, not a payee — every outgoing transfer carries one, so
   * treating it as "the message identified itself" suppressed the exact-amount
   * evidence on exactly the messages that have no other signal. The user's
   * vehicle lease debits arrive as a bare "as Transfer Out" for 122,867.00
   * against a lease line planned at 122,867.00, and that match was being
   * discarded because of a label that distinguishes nothing.
   *
   * Checked BEFORE the hint, because these messages also infer a `transfer`
   * hint from the same worthless word.
   */
  if (GENERIC_TYPE_LABEL.test(parsed.merchant)) return false;

  if (hint) return true;
  return /[a-z]{3,}/i.test(parsed.merchant);
}

/**
 * Merchant strings that are really transaction-type labels.
 *
 * Anchored to the whole string: a shop genuinely called "Transfer House" must
 * still count as a named merchant, so a substring match would be wrong.
 */
const GENERIC_TYPE_LABEL =
  /^\s*(?:(?:cefts|slips|ctb|mb|ib|atm|pos)\s+)*(?:inward|outward|online|mobile|internet)?\s*(?:transfer|payment|withdrawal|deposit|credit|debit|transaction)(?:\s+(?:in|out|txn|charges?|fees?))?\s*$/i;

/**
 * How exactly two amounts agree, as a separate signal from `amountScore`.
 *
 * `amountScore` deliberately tolerates 15% because utilities move around, but
 * that tolerance also flattens the difference between "within a rupee" and
 * "10% out" — both score well, so an exact hit carries no extra weight. For a
 * fixed commitment that is backwards: paying 42,350.00 against a line planned at
 * exactly 42,350.00 is the strongest evidence available short of the merchant
 * name, and it was being scored the same as 39,000.
 *
 * Returns 1 only for an exact match to the minor unit, 0.5 for a near-miss
 * inside a rupee (rounding between the bank's figure and the user's), else 0.
 */
function exactAmountScore(a: Minor, b: Minor): number {
  if (a <= 0 || b <= 0) return 0;
  if (a === b) return 1;
  return Math.abs(a - b) <= 100 ? 0.5 : 0;
}

/**
 * Score how well a parsed SMS matches one bill. Text similarity dominates
 * (the merchant is the strongest signal); amount agreement and the card's
 * last-4 matching the SMS account add confidence.
 */
function scoreSubcategory(
  parsed: ParsedSms,
  sub: BoardSlice['subcategories'][number],
  board: BoardSlice,
  hint: CategoryHint | null,
  /** Ranked reads of the whole message — see core/merchantSignals.ts. */
  guesses: readonly CategoryGuess[],
): number {
  const category = board.categories.find((c) => c.id === sub.categoryId);
  const cardId = resolveCardId(sub.cardId, category?.cardId);
  const card = board.cards.find((c) => c.id === cardId);
  const billText = `${sub.name} ${category?.name ?? ''}`;

  /*
   * A bank fee belongs on the bank-charges line and nowhere else.
   *
   * Scored here rather than pre-selected in the store, because the store
   * rebuilds every draft from the table on each load — a category chosen there
   * is silently overwritten on the next refresh. Deciding it in the reconciler
   * means the answer survives, and is recomputed the same way every time.
   *
   * "CEFTS Transfer Charges" would otherwise fuzzy-match any line with
   * "transfer" in its name, so an explicit rule is what stops a 25-rupee fee
   * being scored against the user's real transfers.
   */
  if (parsed.kind === 'bank_charge') {
    /*
     * Matched on the LINE'S OWN NAME, not on the hint.
     *
     * The hint says what the message is about; this asks whether this
     * particular line is the one fees belong on. Returning 0 for everything
     * else is what stops "CEFTS Transfer Charges" being scored against the
     * user's real transfer lines, which its wording otherwise invites.
     *
     * When no charges line exists yet the whole match list comes back empty,
     * and the draft falls through to `createLineForDraft` — which proposes
     * "Bank & fees → Bank charges" and creates it only if the user confirms.
     */
    return isBankChargeLine(billText) ? 1 : 0;
  }

  // A loan-payment SMS should settle a loan-linked line and nothing else, so
  // loan lines get a strong prior and other lines a penalty for this kind.
  if (parsed.kind === 'loan_payment') {
    if (!sub.loanId) return amountScore(parsed.amountMinor, sub.plannedMinor) * 0.3;
    // Among loan lines, the amount is the discriminator.
    return 0.6 + amountScore(parsed.amountMinor, sub.plannedMinor) * 0.4;
  }

  // Semantic tag match — a "water" SMS against a bill named/categorised "Water".
  // This is the smart signal the user asked for, so it carries the most weight:
  // it turns "the words happen to overlap" into "this is the same kind of thing".
  const hintHit = hint && billMatchesHint(hint, billText) ? 1 : 0;

  /*
   * The broader read of the message, for everything the hint list never knew.
   *
   * `inferCategoryHint` covers only the ten buckets the shared catalog votes
   * on, so hospitals, restaurants, clothing and hardware shops scored nothing —
   * on the user's real queue that left 9 of 14 drafts with no suggestion at
   * all, despite merchant names like "NAWALOKA HOSPITALS" and "A S P Pharmacy &
   * Grocery" saying plainly what they were.
   *
   * Scored BELOW `hintHit` deliberately: when the narrow list fires it is the
   * better evidence, and this only has to beat "nothing".
   */
  const guessIndex = guesses.findIndex((guess) => lineMatchesCategory(guess.category, billText));
  const guessHit = guessIndex >= 0 ? guesses[guessIndex] : null;

  /*
   * A RUNNER-UP guess is worth less than the winner, not the same.
   *
   * Walking the ranked list and taking the first category that happens to match
   * a line means a losing read can win the match outright. "A S P Pharmacy &
   * Grocery" reads health 0.91, groceries 0.85 — pharmacy leads the name, so
   * health is the answer — but the user's board has a Groceries line and no
   * health line, so the search fell through to the loser and filed a pharmacy
   * visit under Groceries at 0.42. The app concluded health and then quietly
   * did something else.
   *
   * Keeping the runner-up in play is still right: a supermarket that also sells
   * fuel should find the user's Fuel line when it has no Groceries line. What
   * was wrong is pretending the second-best read is as good as the best. So it
   * is discounted by how far it lost by — a near-tie is barely penalised, a
   * distant also-ran barely scores — which lets the confident winner's absence
   * show up as a weak match the user is asked about, instead of a confident
   * match that is wrong.
   */
  const guessScore = guessHit
    ? guessHit.score * (1 - Math.min(1, (guesses[0].score - guessHit.score) * RUNNER_UP_DISCOUNT))
    : 0;

  // Fuzzy text overlap between the SMS and the bill, as a softer fallback.
  const text = textScore(parsed.merchant || parsed.raw, billText);

  const amount = amountScore(parsed.amountMinor, sub.plannedMinor);

  // A card whose last-4 appears in the SMS account is a reliable signal — but
  // only when the message revealed enough digits to be sure (see
  // `isMatchableAccount`).
  const accountHit =
    card?.last4 && isMatchableAccount(parsed.account) && parsed.account.endsWith(card.last4)
      ? 1
      : 0;

  /*
   * Weights, and why the guess is worth as much as the hint.
   *
   * A confident category read ("SPAR" → groceries at 1.00) is the same quality
   * of evidence as the narrow hint list firing — both say "this message is
   * about this kind of thing". Scoring it at 0.3 left SPAR at 0.300 against a
   * Groceries line while `CONFIDENT_MATCH_SCORE` is 0.4, so a perfect read
   * produced no suggestion at all.
   *
   * The two never double-count: `guessHit` and `hintHit` describe the same
   * conclusion from different vocabularies, so `Math.max` takes the better
   * evidence rather than summing them into a falsely confident score.
   */
  const semantic = Math.max(hintHit, guessScore);

  const base = semantic * 0.5 + text * 0.25 + amount * 0.1 + accountHit * 0.2;

  /*
   * An exact hit on a FIXED commitment, when the message named nothing useful.
   *
   * A lease or loan debit routinely arrives as bare text — "LKR 42,350.00
   * debited", no merchant, no "loan" anywhere — so `hint` is null, `textScore`
   * is ~0 and the draft lands with no suggestion at all, even though the board
   * holds a line planned at exactly that figure. The amount is the ONLY signal
   * such a message carries, and against a contractually fixed line it is a
   * strong one.
   *
   * Deliberately narrow, because a bonus on amount alone is exactly how a
   * scorer starts guessing confidently and wrongly:
   *
   *   - only for lines that bill a fixed sum (`isFixedCommitment`) — a utility
   *     landing on its estimate is coincidence, not evidence;
   *   - only on an exact or within-a-rupee match, not the 15% band;
   *   - only when THE MESSAGE ITSELF carries no usable text signal. This is the
   *     subtle one: the test is whether the SMS named anything recognisable at
   *     all, NOT whether it matched *this* line. Keying off `hintHit`/`text`
   *     (both of which are per-line) let a "debited at KEELLS" message claim a
   *     lease line, because against the LEASE line those are naturally zero —
   *     the very check meant to prevent it was guaranteed to pass.
   *
   * Capped below 1 so a genuine merchant match always outranks it.
   */
  if (!messageNamesSomething(parsed, hint) && isFixedCommitment(sub)) {
    const exact = exactAmountScore(parsed.amountMinor, sub.plannedMinor);
    if (exact > 0) return Math.min(0.85, base + exact * 0.5);
  }

  return base;
}

/** Below this, a guess is too weak to auto-select — the user picks instead. */
export const CONFIDENT_MATCH_SCORE = 0.4;

/**
 * Build a draft for a parsed SMS against the board. Income lines are excluded
 * for debit/bill messages (and vice versa) so a spend is never matched to an
 * income line. Returns matches ranked best-first; the top one is pre-selected
 * only if it clears CONFIDENT_MATCH_SCORE.
 */
export function reconcileSms(
  parsed: ParsedSms,
  board: BoardSlice,
  id: string,
  /** Learned merchant rules; omitted (empty) falls back to keyword-only behaviour. */
  rules: readonly MerchantRule[] = [],
  /**
   * The user's currency settings, so a foreign-currency message is converted
   * before it is scored or logged. Defaults keep existing callers (and the
   * LKR-only tests) behaving exactly as before.
   */
  money: { currency: string; usdRate: number } = { currency: 'LKR', usdRate: 300 },
): SmsDraft {
  // A credit is money in (an income line); debit/bill are money out (expense).
  const wantType: 'income' | 'expense' = parsed.direction === 'credit' ? 'income' : 'expense';

  // Convert up front: every comparison below (and the logged figure) must be in
  // the home currency, or a USD salary would be scored against LKR plans.
  const homeMinor = convertToHomeMinor(
    parsed.amountMinor,
    parsed.currency,
    money.currency,
    money.usdRate,
  );
  const foreign =
    parsed.currency && parsed.currency !== money.currency && homeMinor !== parsed.amountMinor
      ? { currency: parsed.currency, amountMinor: parsed.amountMinor }
      : null;
  // Scoring compares against the board's planned amounts, which are all in the
  // home currency — so it must see the converted figure, not the raw one.
  const scoringParsed: ParsedSms = { ...parsed, amountMinor: homeMinor };

  // What the *learned* table makes of this merchant. This is checked before the
  // keyword guess because a rule the user taught us is better evidence than any
  // shipped heuristic — that is the whole point of learning.
  const learned = matchMerchant(parsed.merchant, rules);

  /*
   * Read what the SMS is *for*: the learned hint when we have one, else the
   * transaction's own KIND, else the static keywords over merchant + full text.
   *
   * The kind sits in the middle because for a bank charge it is not a guess.
   * `classifyKind` only returns `bank_charge` when the message names a charge
   * as the transaction's own type, whereas `inferCategoryHint` is a first-match
   * keyword walk that tests `atm` before `bank_charge` — so the fee split out of
   * an ATM receipt, whose text is full of the word "ATM", was labelled "Looks
   * like ATM cash" on a LKR 30.00 row sitting right beneath the LKR 85,000
   * withdrawal it was charged for.
   *
   * Only `bank_charge` is promoted this way. The other kinds genuinely are
   * coarser than the keyword read — a `purchase` says nothing about whether it
   * was groceries or fuel, and letting the kind win there would throw away the
   * better answer.
   */
  // Everything the message says, ranked. Computed once and passed down rather
  // than re-derived per line — it depends only on the message.
  /*
   * The bank's channel heading is stripped before anything reads the message
   * for a CATEGORY — see `withoutChannelHeading`. It describes how the card was
   * used, and its words ("INTERNET") collide with real category vocabulary.
   */
  const categoryText = withoutChannelHeading(parsed.raw);

  const guesses = guessCategories({
    merchant: parsed.merchant,
    raw: categoryText,
    kind: parsed.kind,
  });

  /*
   * Read the message four ways, strongest first, and take the first answer.
   *
   * The last tier is the safety net: rather than showing "Need a category" the
   * moment nothing clears the confidence bar, fall back to any category word
   * the message contains. It only ever fills a blank — see `weakHintFromGuesses`
   * — so no confident reading is affected by its presence.
   */
  /*
   * The hint the SCORING uses — confident readings only.
   *
   * Kept separate from the hint the card displays, because the two answer
   * different questions. This one decides which budget line the money lands on,
   * so it must stay as trustworthy as it was before the fallback existed.
   */
  const scoringHint =
    learned.hint ??
    (parsed.kind === 'bank_charge'
      ? 'bank_charge'
      : (inferCategoryHint(`${parsed.merchant} ${categoryText}`) ?? hintFromGuesses(guesses)));

  const matches: DraftMatch[] = board.subcategories
    .filter((sub) => sub.type === wantType)
    .map((sub) => ({
      subcategoryId: sub.id,
      score: scoreSubcategory(scoringParsed, sub, board, scoringHint, guesses),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  /*
   * The hint the CARD shows, which may be weaker than the one that scored.
   *
   * This is the "say something rather than nothing" tier. When every confident
   * reading came back empty the card would otherwise print "Need a category" on
   * a message that plainly contains one — the user's own "food expenses" being
   * the case that prompted this — so it falls back to any category word found.
   *
   * Crucially it does NOT feed `matches` above, so a weak word can label the
   * row without silently choosing which budget line the money comes out of.
   * The user still picks; they just start from a suggestion instead of a blank.
   */
  const hint = scoringHint ?? weakHintFromGuesses(guesses);

  // A learned rule pointing at a line that still exists and is the right type
  // wins outright — the user already told us this merchant maps here.
  const learnedTarget =
    learned.subcategoryId &&
    board.subcategories.find((sub) => sub.id === learned.subcategoryId && sub.type === wantType)
      ? learned.subcategoryId
      : null;

  const best = matches[0];
  const scoreTarget = best && best.score >= CONFIDENT_MATCH_SCORE ? best.subcategoryId : '';
  const subcategoryId = learnedTarget ?? scoreTarget;

  // `exact` is reserved for a learned rule that resolved to a real line: only
  // then can the UI honestly offer a one-tap confirm. A rule whose line was
  // since deleted degrades to the score-based guess.
  const confidence: MatchConfidence = learnedTarget
    ? learned.confidence
    : subcategoryId
      ? 'likely'
      : 'unknown';

  return {
    id,
    parsed,
    hint,
    subcategoryId,
    amountMinor: homeMinor,
    foreign,
    matches,
    confidence,
    guesses,
    // Filled in asynchronously by the store once the catalog answers; the draft
    // is built synchronously so it can appear immediately, and reconciliation
    // stays a pure function with no network in it.
    suggestions: [],
    createdAt: Date.now(),
  };
}

/**
 * Put every itemised fee directly beneath the transaction it was charged for.
 *
 * ## Why the queue's own ordering gets this wrong
 *
 * `smsInboxRepo.pending()` sorts by when the money moved — date, then time,
 * then arrival. A fee split out of an ATM receipt carries its PARENT's date and
 * time, because both figures come from the same message, so the first two keys
 * tie and the answer falls through to arrival order. The fee is inserted second
 * and sorts DESC, which puts LKR 30.00 above the LKR 85,000.00 withdrawal that
 * explains it — a charge with no visible cause, immediately above its cause.
 *
 * Reading the pair in the other order is the whole point: the user recognises
 * "HNB ATM Withdrawal", and then the fee beneath it needs no explanation.
 *
 * Everything else keeps its existing position. This only ever MOVES a fee row
 * to sit after its own parent, so a queue with no split receipts comes back
 * completely unchanged.
 */
export function orderDraftsWithFees<T extends { parsed: { raw: string } }>(
  drafts: readonly T[],
): T[] {
  /*
   * Index parents by their exact text.
   *
   * Matching on the parent's own raw text rather than on "the nearest ATM row"
   * is what keeps this correct once the queue holds two receipts: each fee
   * carries the text it was split from, so it can only ever attach to the row
   * it actually came from.
   */
  const feesByParent = new Map<string, T[]>();
  for (const draft of drafts) {
    const parent = parentReceiptOf(draft.parsed.raw);
    if (parent === null) continue;

    const existing = feesByParent.get(parent);
    if (existing) existing.push(draft);
    else feesByParent.set(parent, [draft]);
  }

  if (feesByParent.size === 0) return [...drafts];

  const ordered: T[] = [];
  for (const draft of drafts) {
    // A fee is placed by its parent, not by its own position in the queue.
    if (parentReceiptOf(draft.parsed.raw) !== null) continue;

    ordered.push(draft);
    for (const fee of feesByParent.get(draft.parsed.raw) ?? []) ordered.push(fee);
  }

  /*
   * A fee whose parent is no longer in the queue still has to appear.
   *
   * The user can dismiss the withdrawal and keep the fee, which would otherwise
   * drop the row from the board entirely — money silently missing, which is the
   * failure this whole feature exists to prevent.
   */
  const placed = new Set(ordered);
  for (const draft of drafts) {
    if (!placed.has(draft)) ordered.push(draft);
  }

  return ordered;
}
