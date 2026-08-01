import 'server-only';

/**
 * Rank a parsed transaction against the user's board.
 *
 * This is the scoring that used to live on the device. Moving it here means the
 * weights can be tuned — and mistuning corrected — without an app release, and
 * means the crowd catalog and the local board are weighed by one piece of code
 * rather than two that can disagree.
 *
 * The board arrives with the request and is never stored. It is the user's own
 * structure (their line names and planned amounts), so it is used to answer this
 * one question and discarded; nothing here writes it anywhere.
 *
 * Pure: board in, ranking out. No database, no cache, no I/O — which is what
 * makes the weights testable and the endpoint a thin wrapper.
 */

import type { Hint } from './contract';
import { lineMatchesHint } from './hints';

/** How far a line's planned amount may be from the actual and still count. */
const AMOUNT_TOLERANCE = 0.15;

/** Below this, a guess is too weak to pre-select — the user picks instead. */
export const CONFIDENT_MATCH_SCORE = 0.4;

/** One of the user's budget lines, as the device sends it. */
export interface BoardLine {
  id: string;
  name: string;
  type: 'income' | 'expense';
  plannedMinor: number;
  /** Group name, sent flattened so the server needs no second lookup. */
  groupName: string;
  /** Last 4 of the card behind this line, when it has one. */
  cardLast4?: string | null;
  /** True when this line is a loan installment. */
  isLoan?: boolean;
}

export interface RankInput {
  merchant: string;
  /** Direction as parsed: a bill notice ranks like a debit. */
  direction: 'debit' | 'credit' | 'bill';
  kind: string;
  amountMinor: number;
  /** Account fragment the message named, for last-4 matching. */
  account: string;
  hint: Hint | null;
  lines: BoardLine[];
}

export interface RankedLine {
  lineId: string;
  score: number;
}

/** Lowercase, strip punctuation, collapse spaces — for fuzzy comparison. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Overlap between two phrases as the share of the shorter one's words found in
 * the longer. "ceb electricity" vs "electricity bill" -> 0.5. Cheap, good
 * enough to rank a handful of lines, and needs no NLP dependency.
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
function amountScore(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff > AMOUNT_TOLERANCE) return 0;
  return 1 - diff / AMOUNT_TOLERANCE;
}

/**
 * Score one line against the transaction.
 *
 * The hint carries the most weight because it is the difference between "these
 * words happen to overlap" and "this is the same KIND of thing" — text overlap
 * alone matches a bill called "Water" to any message containing the word.
 */
function scoreLine(input: RankInput, line: BoardLine): number {
  const lineText = `${line.name} ${line.groupName}`;

  // A loan payment should settle a loan-linked line and nothing else, so loan
  // lines get a strong prior and everything else a penalty for this kind.
  if (input.kind === 'loan_payment') {
    if (!line.isLoan) return amountScore(input.amountMinor, line.plannedMinor) * 0.3;
    return 0.6 + amountScore(input.amountMinor, line.plannedMinor) * 0.4;
  }

  const hintHit = input.hint && lineMatchesHint(input.hint, lineText) ? 1 : 0;
  const text = textScore(input.merchant, lineText);
  const amount = amountScore(input.amountMinor, line.plannedMinor);
  const accountHit =
    line.cardLast4 && input.account && input.account.endsWith(line.cardLast4) ? 1 : 0;

  return hintHit * 0.45 + text * 0.25 + amount * 0.1 + accountHit * 0.2;
}

/**
 * Rank every eligible line, best first.
 *
 * Income lines are excluded for debits and expense lines for credits, so a
 * spend is never matched to an income line however well the words happen to
 * line up.
 */
export function rankLines(input: RankInput): RankedLine[] {
  const wantType: 'income' | 'expense' = input.direction === 'credit' ? 'income' : 'expense';

  return input.lines
    .filter((line) => line.type === wantType)
    .map((line) => ({ lineId: line.id, score: scoreLine(input, line) }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score);
}
