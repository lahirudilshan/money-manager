/**
 * How the three evidence sources become one ranked list.
 *
 * Deliberately pure and SQL-free: the weights below are the product decisions in
 * this service, and they should be readable — and changeable — without anyone
 * having to understand a window function first. `lib/repository.ts` fetches,
 * this decides, `lib/catalog.ts` caches.
 */

import { MAX_SUGGESTIONS, type Hint } from './contract';
import type { HintCount, HintVotes } from './repository';

/**
 * Weights, as shares of a suggestion's final confidence.
 *
 * MERCHANT and AMOUNT deliberately ADD: a hint backed by both the shop and its
 * transaction shape is the strongest evidence available and should be able to
 * reach 1.0. SENDER is capped well below a merchant match because knowing the
 * bank is much weaker evidence than knowing the shop.
 */
const WEIGHT = {
  merchant: 0.7,
  amount: 0.3,
  sender: 0.45,
} as const;

/** Why a suggestion ranked where it did — shown to the user in the UI. */
export type SuggestionReason = 'merchant' | 'merchant-amount' | 'sender';

export interface Suggestion {
  hint: Hint;
  /** 0-1. Rendered as a percentage and used for ordering. */
  confidence: number;
  reason: SuggestionReason;
}

/** Total of a tally, for turning counts into shares. */
function total(rows: { votes?: number; n?: number }[]): number {
  return rows.reduce((sum, row) => sum + Number(row.votes ?? row.n ?? 0), 0);
}

/**
 * Combine the three sources into at most three ranked suggestions.
 *
 * Confidence is a SHARE of the evidence behind a merchant, not a raw count: 8 of
 * 10 votes is 0.8 whether the merchant has ten votes or ten thousand, which is
 * what makes the number comparable between rows in the UI.
 *
 * `bySender` is expected to be empty unless the merchant is unknown — see
 * `suggestionsFor` in lib/catalog.ts. Passing both would let a bank that sends
 * alerts for everything drown out a merchant the crowd actually voted on.
 */
export function rankSuggestions(
  byMerchant: readonly HintVotes[],
  bySignal: readonly HintCount[],
  bySender: readonly HintCount[],
): Suggestion[] {
  const scores = new Map<Hint, { score: number; reason: SuggestionReason }>();

  const merchantTotal = total([...byMerchant]);
  for (const row of byMerchant) {
    if (merchantTotal === 0) break;
    scores.set(row.hint, {
      score: (Number(row.votes) / merchantTotal) * WEIGHT.merchant,
      reason: 'merchant',
    });
  }

  const signalTotal = total([...bySignal]);
  for (const row of bySignal) {
    if (signalTotal === 0) break;
    const current = scores.get(row.hint);
    scores.set(row.hint, {
      score: (current?.score ?? 0) + (Number(row.n) / signalTotal) * WEIGHT.amount,
      reason: 'merchant-amount',
    });
  }

  const senderTotal = total([...bySender]);
  for (const row of bySender) {
    if (senderTotal === 0) break;
    scores.set(row.hint, {
      score: (Number(row.n) / senderTotal) * WEIGHT.sender,
      reason: 'sender',
    });
  }

  return [...scores.entries()]
    .map(([hint, { score, reason }]) => ({
      hint,
      confidence: Math.min(1, Math.round(score * 100) / 100),
      reason,
    }))
    // Alphabetical tie-break so two devices asking at the same instant agree.
    .sort((a, b) => b.confidence - a.confidence || a.hint.localeCompare(b.hint))
    .slice(0, MAX_SUGGESTIONS);
}
