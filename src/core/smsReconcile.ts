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

import type { ParsedSms } from './smsParser';
import { resolveCardId } from './planning';
import { billMatchesHint, inferCategoryHint, type CategoryHint } from './smsCategoryHints';
import { matchMerchant, type MatchConfidence, type MerchantRule } from './merchantRules';
import type { Minor } from './money';

/** The minimum a leaf's plan/actual and the SMS must be within to count as an
 * amount match, as a fraction — utilities vary month to month. */
const AMOUNT_TOLERANCE = 0.15;

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
  /** Amount to log, in minor units — starts from the parsed amount. */
  amountMinor: Minor;
  /** Ranked alternatives for the "pick a different bill" dropdown. */
  matches: DraftMatch[];
  /**
   * How sure we are of `subcategoryId`, which decides what the review UI
   * offers: `exact` means a learned rule recognised this merchant outright and
   * the user need only tap Yes; `likely` is a guess worth showing; `unknown`
   * means the user must choose (and that choice is what teaches the system).
   */
  confidence: MatchConfidence;
  /** When the draft was created, for ordering the queue newest-first. */
  createdAt: number;
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
    /** Set when this line is a loan installment — targets loan-payment SMS. */
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
  if (!account) return undefined;
  return cards.find((card) => card.last4 && account.endsWith(card.last4));
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
 * Score how well a parsed SMS matches one bill. Text similarity dominates
 * (the merchant is the strongest signal); amount agreement and the card's
 * last-4 matching the SMS account add confidence.
 */
function scoreSubcategory(
  parsed: ParsedSms,
  sub: BoardSlice['subcategories'][number],
  board: BoardSlice,
  hint: CategoryHint | null,
): number {
  const category = board.categories.find((c) => c.id === sub.categoryId);
  const cardId = resolveCardId(sub.cardId, category?.cardId);
  const card = board.cards.find((c) => c.id === cardId);
  const billText = `${sub.name} ${category?.name ?? ''}`;

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

  // Fuzzy text overlap between the SMS and the bill, as a softer fallback.
  const text = textScore(parsed.merchant || parsed.raw, billText);

  const amount = amountScore(parsed.amountMinor, sub.plannedMinor);

  // A card whose last-4 appears in the SMS account is a reliable signal.
  const accountHit = card?.last4 && parsed.account.endsWith(card.last4) ? 1 : 0;

  return hintHit * 0.45 + text * 0.25 + amount * 0.1 + accountHit * 0.2;
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
): SmsDraft {
  // A credit is money in (an income line); debit/bill are money out (expense).
  const wantType: 'income' | 'expense' = parsed.direction === 'credit' ? 'income' : 'expense';

  // What the *learned* table makes of this merchant. This is checked before the
  // keyword guess because a rule the user taught us is better evidence than any
  // shipped heuristic — that is the whole point of learning.
  const learned = matchMerchant(parsed.merchant, rules);

  // Read what the SMS is *for*: the learned hint when we have one, else the
  // static keywords over the merchant + full text.
  const hint = learned.hint ?? inferCategoryHint(`${parsed.merchant} ${parsed.raw}`);

  const matches: DraftMatch[] = board.subcategories
    .filter((sub) => sub.type === wantType)
    .map((sub) => ({ subcategoryId: sub.id, score: scoreSubcategory(parsed, sub, board, hint) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

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
    amountMinor: parsed.amountMinor,
    matches,
    confidence,
    createdAt: Date.now(),
  };
}
