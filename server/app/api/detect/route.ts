/**
 * POST /api/detect — server-side detection.
 *
 * NOT on the mobile app's path. The app is local-first: it mirrors the catalog
 * at launch (`/api/hints`) and categorises every message on-device, because an
 * SMS arrives at a fuel pump or in a supermarket queue, exactly where signal is
 * worst. A per-transaction round trip would fail the feature precisely when it
 * is needed.
 *
 * Kept because it is the natural entry point for a client that has no local
 * database — a web dashboard, an integration — and because its tests are what
 * guard `lib/hints.ts` and `lib/rank.ts`, whose keyword quality the mirrored
 * catalog depends on.
 *
 * One call answers "what is this transaction, and which of your lines does it
 * belong to?", combining three things a thin client cannot weigh alone:
 *
 *   1. the shipped KEYWORDS (lib/hints.ts) — correctable by deploy rather than
 *      by an app release and a wait for users to update;
 *   2. the CROWD catalog — what other users settled on for this merchant;
 *   3. the user's own BOARD, sent with the request and ranked by lib/rank.ts.
 *
 * What it never receives is the message text. The device parses locally and
 * sends only the fields it extracted; the schema is `.strict()`, so a client
 * that tried to attach the raw SMS gets a 400 rather than quietly shipping
 * balances and account numbers to a server.
 *
 * The board is used to answer this request and discarded — nothing here writes
 * it to any table.
 */

import { getSuggestions, type Suggestion } from '@/lib/catalog';
import { bucketFor, detectSchema, type Hint } from '@/lib/contract';
import { inferHint } from '@/lib/hints';
import { guard, json, preflight, readJson } from '@/lib/http';
import { rankLines, CONFIDENT_MATCH_SCORE, type RankedLine } from '@/lib/rank';
import { clientKey, rateLimit } from '@/lib/rateLimit';

/**
 * Detections per minute per client. Well above real usage — a busy day is a few
 * dozen messages — while still capping a runaway loop, which matters because
 * each call can reach the database.
 */
const DETECT_LIMIT = 120;

/** Ranked alternatives returned for the picker. */
const MAX_MATCHES = 20;

/** What a detection answers, whether or not anything was recognised. */
interface DetectResult {
  hint: Hint | null;
  /** The chosen line, or '' when nothing cleared the confidence bar. */
  lineId: string;
  matches: RankedLine[];
  suggestions: Suggestion[];
  confidence: number;
}

/**
 * An empty answer, which the device reads as "fall back to local detection".
 * Returned instead of a 500 so a catalog outage costs accuracy rather than
 * blocking someone from logging a transaction.
 */
const NO_DETECTION: DetectResult = {
  hint: null,
  lineId: '',
  matches: [],
  suggestions: [],
  confidence: 0,
};

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request), DETECT_LIMIT);
  if (!limit.ok) {
    return json({ error: 'too many requests' }, 429, { 'Retry-After': String(limit.retryAfter) });
  }

  const input = await readJson(request, detectSchema);
  if (!input.ok) return input.response;

  const { merchant, direction, kind, amountMinor, account, sender, lines } = input.data;

  return guard<DetectResult>(
    'detect',
    async () => {
      /*
       * The crowd is consulted first and its winner becomes the hint, because a
       * merchant thousands of users have categorised is better evidence than a
       * shipped word list. Keywords are the fallback for merchants nobody has
       * voted on yet.
       */
      const suggestions = await getSuggestions(
        merchant,
        sender ?? null,
        direction === 'credit' ? 'credit' : 'debit',
        bucketFor(amountMinor / 100),
      );

      const hint: Hint | null = suggestions[0]?.hint ?? inferHint(merchant);
      const ranked = rankLines({ merchant, direction, kind, amountMinor, account, hint, lines });

      /*
       * Only pre-select when the top score clears the bar. Below it the ranking
       * is still returned — the device shows it as a list to choose from — but
       * nothing is pre-ticked, because auto-confirming a weak guess is how a
       * detection feature loses the user's trust.
       */
      const best = ranked[0];
      const lineId = best && best.score >= CONFIDENT_MATCH_SCORE ? best.lineId : '';

      return {
        hint,
        lineId,
        matches: ranked.slice(0, MAX_MATCHES),
        suggestions,
        confidence: lineId ? (suggestions[0]?.confidence ?? 0.5) : 0,
      };
    },
    NO_DETECTION,
  );
}

export function OPTIONS() {
  return preflight();
}
