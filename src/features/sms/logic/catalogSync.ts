/**
 * Merging the shared catalog into the device's own rules, and deciding what
 * this device contributes back.
 *
 * The app is LOCAL-FIRST. The whole catalog is mirrored into SQLite at launch,
 * and every detection afterwards runs on-device with no network involved —
 * because an SMS arrives when a transaction happens, which is at a fuel pump or
 * in a supermarket queue, exactly where signal is worst. Requiring a round trip
 * at that moment would fail the feature precisely when it is needed.
 *
 * Two tables answer different questions and must not be confused:
 *
 *   - the SHARED catalog knows what a merchant *is* — "keells" is groceries.
 *     That generalises across users, so it is crowd-sourced and mirrored.
 *   - the LOCAL rules know which of *this user's budget lines* to log against.
 *     A subcategory id means nothing on another device, so it is never shared
 *     and never overwritten.
 *
 * A pulled row can therefore only ever supply a `hint`. It can create a
 * hint-only rule where the user had nothing, and correct a stale hint on a rule
 * the app itself seeded — but a rule the user personally taught is untouchable.
 * Someone pointing "fli trading" at their Groceries line is the single most
 * valuable fact in the table, and no amount of crowd agreement is evidence
 * about which line THEY meant.
 *
 * Pure: plain arrays in, a plan of edits out. The repository executes it, so
 * every precedence rule above is unit-testable without a database.
 */

import type { CategoryHint } from './smsCategoryHints';
import type { MerchantRule } from './merchantRules';

/** One merchant→hint pairing as the catalog serves it. */
export interface SharedRule {
  /** Already normalised by the server with the same `merchantKey` the app uses. */
  merchant: string;
  hint: CategoryHint;
  /** Devices backing this pairing. */
  votes: number;
  /** 'seed' shipped with the catalog; 'learned' came from user corrections. */
  source: 'seed' | 'learned';
  /** The winner's lead over the runner-up hint for this merchant. */
  margin: number;
}

/** The edits a sync implies, for the repository to apply. */
export interface CatalogPlan {
  /** Merchants the device has never seen — inserted as hint-only rules. */
  insert: { pattern: string; hint: CategoryHint }[];
  /** Existing rules whose hint the catalog corrects. Ids are local rule ids. */
  updateHint: { id: string; hint: CategoryHint }[];
}

/**
 * A contested merchant teaches nothing. Below this lead the catalog is saying
 * "users disagree about this shop", and mirroring the bare winner would push a
 * coin-flip onto every device as though it were settled.
 */
export const MIN_MARGIN = 2;

/**
 * Reconcile pulled rows against local rules.
 *
 * Precedence, strongest first:
 *
 *  1. a local 'learned' rule wins outright — the user taught us this merchant,
 *     so neither its hint nor its line is touched. This is the guarantee that
 *     syncing can never undo a correction someone deliberately made.
 *  2. a local 'seed' rule keeps its line but takes the catalog's hint when they
 *     disagree, because a shipped keyword guess is exactly what the crowd is
 *     better placed to correct.
 *  3. no local rule at all: insert a hint-only rule (subcategoryId null). It
 *     cannot say which line to use, but it makes the next message from that
 *     merchant arrive already knowing what kind of thing it is — offline.
 */
export function planCatalogMerge(
  shared: readonly SharedRule[],
  local: readonly MerchantRule[],
): CatalogPlan {
  const plan: CatalogPlan = { insert: [], updateHint: [] };

  // Local rules keyed by pattern. A merchant can legitimately hold several rules
  // (a shop that is sometimes groceries, sometimes fuel), and a single 'learned'
  // rule among them is enough to make the whole merchant off-limits.
  const byPattern = new Map<string, MerchantRule[]>();
  for (const rule of local) {
    const bucket = byPattern.get(rule.pattern);
    if (bucket) bucket.push(rule);
    else byPattern.set(rule.pattern, [rule]);
  }

  // Guard against a merchant appearing twice in one page: apply the first (the
  // server orders best-first) and ignore the rest, so the plan never contains
  // two conflicting edits for one row.
  const seen = new Set<string>();

  for (const row of shared) {
    if (!row.merchant || seen.has(row.merchant)) continue;
    seen.add(row.merchant);

    // A contested pairing is no better than no information.
    if (row.margin < MIN_MARGIN) continue;

    const existing = byPattern.get(row.merchant);

    if (!existing || existing.length === 0) {
      plan.insert.push({ pattern: row.merchant, hint: row.hint });
      continue;
    }

    // Rule 1: anything the user taught makes this merchant untouchable.
    if (existing.some((rule) => rule.source === 'learned')) continue;

    // Rule 2: correct a shipped guess, but only when it actually differs —
    // rewriting an identical hint would churn `updatedAt` on every sync.
    for (const rule of existing) {
      if (rule.hint !== row.hint) plan.updateHint.push({ id: rule.id, hint: row.hint });
    }
  }

  return plan;
}

/**
 * Coarse amount bands, in home-currency MAJOR units.
 *
 * Must stay identical to AMOUNT_BUCKETS in server/lib/contract.ts — the server
 * validates against its own copy, so a drifted band here is a rejected request.
 *
 * The exact amount never leaves the device: it is a personal detail and, across
 * a few transactions, a fingerprint. A band is enough to tell "a phone bill"
 * from "a new handset at the same merchant", which is all the ranking needs.
 */
export type AmountBucket =
  | 'under_500'
  | '500_2k'
  | '2k_10k'
  | '10k_50k'
  | '50k_200k'
  | 'over_200k';

/** Place an amount, in MINOR units, into its band. */
export function bucketForMinor(amountMinor: number): AmountBucket {
  const major = Math.abs(amountMinor) / 100;
  if (major < 500) return 'under_500';
  if (major < 2_000) return '500_2k';
  if (major < 10_000) return '2k_10k';
  if (major < 50_000) return '10k_50k';
  if (major < 200_000) return '50k_200k';
  return 'over_200k';
}

/**
 * One observation this device offers back to the catalog.
 *
 * Note what has no field here: message text, the exact amount, the balance, the
 * account or card number, the date, and the user's own line names. The server
 * rejects a payload carrying any of them, so this type and that check are two
 * halves of the same guarantee.
 */
export interface Observation {
  merchant: string;
  hint: CategoryHint;
  /** Bank/utility short code, when the message named one. Never a phone number. */
  sender?: string | null;
  direction: 'debit' | 'credit';
  amountBucket: AmountBucket;
}

/** A local rule plus the transaction shape last seen for it. */
export interface ObservationSource {
  rule: MerchantRule;
  sender?: string | null;
  direction?: 'debit' | 'credit';
  amountMinor?: number;
}

/**
 * Which local rules are worth uploading.
 *
 * Only 'learned' rules with a hint: a seed rule is just the shipped catalog
 * echoed back — it would vote for whatever the app already believed, inflating
 * consensus with no new information — and a rule with no hint has nothing
 * shareable, since its subcategory id is meaningless elsewhere.
 */
export function observationsFrom(sources: readonly ObservationSource[]): Observation[] {
  const best = new Map<string, { source: ObservationSource; hitCount: number }>();

  for (const source of sources) {
    const { rule } = source;
    if (rule.source !== 'learned' || !rule.hint || !rule.pattern) continue;

    // One observation per merchant: when the user has several rules for one
    // shop, the most-confirmed hint is the one this device stands behind.
    const current = best.get(rule.pattern);
    if (!current || rule.hitCount > current.hitCount) {
      best.set(rule.pattern, { source, hitCount: rule.hitCount });
    }
  }

  return [...best.entries()].map(([merchant, { source }]) => ({
    merchant,
    hint: source.rule.hint as CategoryHint,
    sender: source.sender ?? null,
    // An expense is the overwhelmingly common case, and the direction only
    // narrows ranking — defaulting is better than dropping the observation.
    direction: source.direction ?? 'debit',
    amountBucket: bucketForMinor(source.amountMinor ?? 0),
  }));
}

/** A ranked category suggestion, as the catalog serves it. */
export interface CatalogSuggestion {
  hint: CategoryHint;
  /** 0-1. Rendered as a percentage and used for ordering. */
  confidence: number;
  /** Why this ranked where it did, for the detail sheet. */
  reason: 'merchant' | 'merchant-amount' | 'sender';
}

/**
 * The confidence a suggestion needs before the UI pre-selects it.
 *
 * Below this the top suggestion is still shown, but as one of several choices
 * rather than a pre-ticked answer — auto-confirming a coin-flip is how a
 * detection feature loses a user's trust.
 */
export const AUTO_SELECT_CONFIDENCE = 0.6;
