/**
 * Merchant → category learning.
 *
 * `smsCategoryHints` answers "what *kind* of thing is this?" from a fixed
 * keyword list. That list can never know that "F L I TRADING" is the corner
 * supermarket, because only the user knows. This module is the half that
 * learns: a table of merchant patterns mapped onto real board lines, seeded
 * from the static keywords and then *grown every time the user corrects a
 * guess*.
 *
 * The flow the user asked for:
 *   1. an SMS arrives naming a merchant we've never seen
 *   2. we show our best guess (from keywords) or nothing at all
 *   3. the user confirms it, or picks the right line themselves
 *   4. either way we write a rule keyed on that merchant
 *   5. next time the same merchant appears we match it outright, with
 *      confidence, and the user only has to tap "Yes"
 *
 * Everything here is pure: it takes plain rule arrays, never the database, so
 * the ranking logic is unit-testable and the repository stays a thin CRUD
 * layer over it.
 */

import type { CategoryHint } from './smsCategoryHints';

/** How a rule came to exist — drives confidence and whether it can be pruned. */
export type MerchantRuleSource =
  /** Shipped with the app, derived from the static keyword list. */
  | 'seed'
  /** Written because the user confirmed or corrected a guess. */
  | 'learned';

/**
 * One learned association: "text matching `pattern` means this line".
 *
 * `pattern` is a *normalised merchant key*, not a regex — see `merchantKey`.
 * Keeping it plain text means rules are safe to store, cheap to compare, and
 * can never blow up on a user-supplied merchant containing regex characters.
 */
export interface MerchantRule {
  id: string;
  /** Normalised merchant text this rule fires on. */
  pattern: string;
  /** The board line to log against. Null for a hint-only (seed) rule. */
  subcategoryId: string | null;
  /** The semantic bucket, kept so a rule still helps after its line is gone. */
  hint: CategoryHint | null;
  source: MerchantRuleSource;
  /** How many times the user has confirmed this mapping. Higher = surer. */
  hitCount: number;
  updatedAt: number;
}

/**
 * Reduce raw merchant text to a stable comparison key.
 *
 * Bank alerts are noisy in ways that are meaningless for identity: casing,
 * punctuation, a branch suffix, and — crucially for Sri Lankan POS text — the
 * letter-spaced form banks emit ("F L I TRADING" for "FLI TRADING"). Single
 * letters separated by spaces are glued back together so both spellings of the
 * same merchant land on one key and share one learned rule.
 */
export function merchantKey(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';

  // Glue runs of single characters: "f l i trading" -> "fli trading".
  const glued = base
    .split(' ')
    .reduce<string[]>((words, word) => {
      const previous = words[words.length - 1];
      if (word.length === 1 && previous && previous.length <= 2 && /^[a-z0-9]+$/.test(previous)) {
        words[words.length - 1] = previous + word;
        return words;
      }
      words.push(word);
      return words;
    }, [])
    .join(' ');

  // Drop trailing location/branch noise a POS line appends after the name.
  return glued.replace(/\s+(lk|pvt|ltd|limited|branch)\b/g, '').trim();
}

/** Confidence bands the review UI renders differently. */
export type MatchConfidence =
  /** An exact learned merchant match — safe to offer as a one-tap confirm. */
  | 'exact'
  /** A partial/keyword match — offer it, but expect a correction. */
  | 'likely'
  /** Nothing usable; the user must choose. */
  | 'unknown';

/** What the rule table makes of a merchant. */
export interface MerchantMatch {
  subcategoryId: string | null;
  hint: CategoryHint | null;
  confidence: MatchConfidence;
  /** The rule that produced this, when one did. */
  rule: MerchantRule | null;
}

const NO_MATCH: MerchantMatch = {
  subcategoryId: null,
  hint: null,
  confidence: 'unknown',
  rule: null,
};

/**
 * Rank a merchant against the learned rules.
 *
 * An exact key equality wins outright — that is the "system already knows this
 * shop" case, and it is reported as `exact` so the UI can show a confident
 * one-tap confirm. Failing that, a containment match (either direction, so
 * "keells" matches "keells super sinharamul") counts as `likely`. Among equal
 * candidates the most-confirmed rule wins, then the most recent, so repeated
 * user corrections genuinely improve accuracy over time.
 */
export function matchMerchant(merchant: string, rules: readonly MerchantRule[]): MerchantMatch {
  const key = merchantKey(merchant);
  if (!key) return NO_MATCH;

  const byStrength = (a: MerchantRule, b: MerchantRule) =>
    b.hitCount - a.hitCount || b.updatedAt - a.updatedAt;

  // Single pass for the strongest exact match. `filter().sort()[0]` allocated
  // two arrays and did O(n log n) work to read one element, on every message a
  // drain imports.
  let exact: MerchantRule | undefined;
  for (const rule of rules) {
    if (rule.pattern !== key) continue;
    if (!exact || byStrength(rule, exact) < 0) exact = rule;
  }
  if (exact) {
    return {
      subcategoryId: exact.subcategoryId,
      hint: exact.hint,
      confidence: 'exact',
      rule: exact,
    };
  }

  // Containment, longest pattern first — a more specific rule should beat a
  // broad one ("keells super" over "keells") before hit count is consulted.
  const byContainment = (a: MerchantRule, b: MerchantRule) =>
    b.pattern.length - a.pattern.length || byStrength(a, b);

  let partial: MerchantRule | undefined;
  for (const rule of rules) {
    if (rule.pattern.length < 3) continue;
    if (!key.includes(rule.pattern) && !rule.pattern.includes(key)) continue;
    if (!partial || byContainment(rule, partial) < 0) partial = rule;
  }

  if (partial) {
    return {
      subcategoryId: partial.subcategoryId,
      hint: partial.hint,
      confidence: 'likely',
      rule: partial,
    };
  }

  return NO_MATCH;
}

/**
 * The rule-table edit implied by the user resolving a draft.
 *
 * Returned rather than applied so the caller (the repository) owns all
 * database writes and this stays pure. `null` means there is nothing worth
 * remembering — an empty merchant teaches us nothing.
 */
export type RuleUpsert =
  | { kind: 'insert'; pattern: string; subcategoryId: string; hint: CategoryHint | null }
  | { kind: 'strengthen'; id: string; subcategoryId: string };

/**
 * The rule key for a payee account, namespaced so it can never collide with a
 * merchant name.
 *
 * An unnamed transfer — the user typed no reason and the bank named no payee —
 * has exactly one stable identifier: the masked destination account. Reusing
 * the merchant-rule table for it means a payee the user has categorised ONCE is
 * recognised on every later transfer to the same account, with no new storage,
 * no new sync path and no second matcher to keep in step.
 *
 * The mask is kept (`13802XXXXX50`, not `50`) because the visible tail alone is
 * shared by every account ending in those digits — see
 * MIN_MATCHABLE_ACCOUNT_DIGITS in smsParser.ts.
 */
export function payeeAccountKey(payeeAccount: string): string {
  const normalised = payeeAccount.trim().toLowerCase().replace(/\s+/g, '');
  return normalised ? `acct:${normalised}` : '';
}

export function planRuleUpsert(
  merchant: string,
  subcategoryId: string,
  hint: CategoryHint | null,
  rules: readonly MerchantRule[],
  /**
   * Skip merchant normalisation, for a key that is already one.
   *
   * `merchantKey` strips punctuation, so feeding it a payee key turns
   * "acct:13802xxxxx50" into "acct 13802xxxxx50" — a DIFFERENT string from the
   * one the matcher looks up, so the rule would be written under a key that is
   * never read and the payee tier would silently never fire.
   */
  preNormalised = false,
): RuleUpsert | null {
  const key = preNormalised ? merchant : merchantKey(merchant);
  if (!key || !subcategoryId) return null;

  // An existing rule on this exact merchant is updated in place: confirming it
  // strengthens it, correcting it re-points it at the line the user chose.
  const existing = rules.find((rule) => rule.pattern === key);
  if (existing) return { kind: 'strengthen', id: existing.id, subcategoryId };

  return { kind: 'insert', pattern: key, subcategoryId, hint };
}
