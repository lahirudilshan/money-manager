/**
 * Search across everything the app keeps: the board (transactions, bills,
 * categories, accounts, loans) and every add-on that is switched on.
 *
 * Pure: the screen gathers the rows and this ranks them, so the matching rules
 * are tested without a database.
 *
 * Every word typed must match (AND, by prefix), so typing more narrows: "fuel
 * dec" finds December's fuel bill, not every bill and every December. A word in
 * the title outranks one in the details, and a newer row wins a tie, since the
 * thing being looked for is usually recent.
 */

import type { MiniAppId } from '~/shared/lib/miniApps';

export type SearchScope =
  | 'transactions'
  | 'bills'
  | 'categories'
  | 'accounts'
  | 'loans'
  | 'income'
  | 'sms'
  | 'documents'
  | 'vehicles'
  | 'buddyloans'
  | 'trackers'
  | 'health';

export interface ScopeInfo {
  id: SearchScope;
  label: string;
  icon: string;
  /** Tile colour, from the category palette (add-ons use their own registry colour). */
  color: string;
  /** The add-on that must be on for this scope to exist; core scopes have none. */
  addOn?: MiniAppId;
}

/** Chip and section order on the search screen. */
export const SCOPES: ScopeInfo[] = [
  { id: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', color: '#2563EB' },
  { id: 'bills', label: 'Bills', icon: 'receipt-outline', color: '#0891B2' },
  { id: 'categories', label: 'Categories', icon: 'albums-outline', color: '#9333EA' },
  { id: 'accounts', label: 'Accounts', icon: 'card-outline', color: '#0284C7' },
  { id: 'loans', label: 'Loans', icon: 'cash-outline', color: '#EA580C' },
  { id: 'income', label: 'Income', icon: 'trending-up-outline', color: '#16A34A' },
  { id: 'sms', label: 'SMS', icon: 'chatbox-ellipses-outline', color: '#475569' },
  { id: 'documents', label: 'Documents', icon: 'folder-open-outline', color: '#CA8A04', addOn: 'documents' },
  { id: 'vehicles', label: 'Vehicles', icon: 'car-sport-outline', color: '#0E9F6E', addOn: 'fuel' },
  { id: 'buddyloans', label: 'Buddy loans', icon: 'people-outline', color: '#0E7C86', addOn: 'buddyloans' },
  { id: 'trackers', label: 'Trackers', icon: 'repeat-outline', color: '#7C3AED', addOn: 'trackers' },
  { id: 'health', label: 'Health', icon: 'heart-outline', color: '#D6336C', addOn: 'health' },
];

/** The scopes that exist for this user: the core ones plus each enabled add-on's. */
export function availableScopes(enabled: ReadonlySet<MiniAppId>): ScopeInfo[] {
  return SCOPES.filter((scope) => !scope.addOn || enabled.has(scope.addOn));
}

export interface SearchItem {
  /** Unique across scopes, e.g. "transactions:abc". */
  key: string;
  scope: SearchScope;
  title: string;
  /** One line under the title: where it lives, the date, who it is for. */
  subtitle?: string;
  /** Text that should match but isn't shown: notes, tags, bank, raw SMS. */
  details?: (string | null | undefined)[];
  /** Shown as the row's figure. */
  amountMinor?: number | null;
  /** Money in shows green with "+"; out shows ink. Absent = a plain figure. */
  flow?: 'in' | 'out';
  /** Small word on the row naming what it is within its scope: "Fill-up", "Medicine". */
  kind?: string;
  /** Icon override for that kind. */
  icon?: string;
  /** Where a tap goes. */
  route: string;
  /** For recency ranking. */
  date?: Date | null;
}

export interface SearchHit {
  item: SearchItem;
  score: number;
}

/** Lowercase, accent-folded words. Digits are kept so amounts and plates match. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const DAY_MS = 86_400_000;

/**
 * A small nudge toward recent rows, never enough to beat a better text match:
 * at most 2 points, gone after about a year.
 */
function recencyBoost(date: Date | null | undefined, now: number): number {
  if (!date) return 0;
  const ageDays = Math.max(0, (now - date.getTime()) / DAY_MS);
  if (ageDays <= 7) return 2;
  if (ageDays <= 31) return 1.5;
  if (ageDays <= 90) return 1;
  if (ageDays <= 365) return 0.5;
  return 0;
}

/**
 * Score one item, or null when some word doesn't match.
 *
 * Per word: exact title word 10, title prefix 7, kind/subtitle prefix 3,
 * hidden-details prefix 1. On top: the whole query equal to the title (+25),
 * the title starting with it (+12), the phrase appearing in the title (+6),
 * every word landing in the title (+5), and a little for recency. Shorter
 * titles win ties: "Fuel" before "Fuel for the generator".
 */
interface Tokens {
  title: string;
  titleWords: string[];
  shownWords: string[];
  hiddenWords: string[];
}

/**
 * Each item's words, split once and reused on every keystroke. Keyed by the
 * object, so a rebuilt index (new objects) is re-split and the old entries are
 * garbage-collected with it.
 */
const tokenCache = new WeakMap<SearchItem, Tokens>();

function tokensOf(item: SearchItem): Tokens {
  let tokens = tokenCache.get(item);
  if (!tokens) {
    tokens = {
      title: words(item.title).join(' '),
      titleWords: words(item.title),
      shownWords: words([item.kind, item.subtitle].filter(Boolean).join(' ')),
      hiddenWords: words((item.details ?? []).filter((d): d is string => !!d).join(' ')),
    };
    tokenCache.set(item, tokens);
  }
  return tokens;
}

function scoreItem(item: SearchItem, terms: string[], phrase: string, now: number): number | null {
  const { title, titleWords, shownWords, hiddenWords } = tokensOf(item);

  let score = 0;
  let allInTitle = true;
  for (const term of terms) {
    if (titleWords.includes(term)) score += 10;
    else if (titleWords.some((w) => w.startsWith(term))) score += 7;
    else {
      allInTitle = false;
      if (shownWords.some((w) => w.startsWith(term))) score += 3;
      else if (hiddenWords.some((w) => w.startsWith(term))) score += 1;
      else return null;
    }
  }

  if (title === phrase) score += 25;
  else if (title.startsWith(phrase)) score += 12;
  else if (title.includes(phrase)) score += 6;
  if (allInTitle) score += 5;

  score += recencyBoost(item.date, now);
  score -= Math.min(titleWords.length, 10) * 0.1;
  return score;
}

/**
 * Rank `items` against `query`, best first, limited to `scope` when given.
 *
 * Every word typed must match (AND, by prefix), so typing more narrows. An
 * empty query returns nothing: the screen shows its own prompt instead.
 */
export function searchAll(
  items: readonly SearchItem[],
  query: string,
  scope: SearchScope | null = null,
  now: number = Date.now(),
): SearchHit[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const phrase = terms.join(' ');

  const hits: SearchHit[] = [];
  for (const item of items) {
    if (scope && item.scope !== scope) continue;
    const score = scoreItem(item, terms, phrase, now);
    if (score !== null) hits.push({ item, score });
  }

  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.item.date?.getTime() ?? 0) - (a.item.date?.getTime() ?? 0) ||
      a.item.title.localeCompare(b.item.title),
  );
}

/** How many hits each scope has, for the counts on the chips. */
export function countByScope(hits: readonly SearchHit[]): Map<SearchScope, number> {
  const counts = new Map<SearchScope, number>();
  for (const hit of hits) counts.set(hit.item.scope, (counts.get(hit.item.scope) ?? 0) + 1);
  return counts;
}

export interface HitGroup {
  scope: ScopeInfo;
  hits: SearchHit[];
  /** Every hit in the scope, so the section can say "See all 23". */
  total: number;
}

/**
 * The "All" view: the best few overall as Top matches, then one section per
 * scope, sections ordered by their best hit so the most relevant kind comes
 * first. A hit shown in Top matches isn't repeated in its section.
 */
export function groupHits(
  hits: readonly SearchHit[],
  scopes: readonly ScopeInfo[],
  { top = 3, perGroup = 4 }: { top?: number; perGroup?: number } = {},
): { top: SearchHit[]; groups: HitGroup[] } {
  const topHits = hits.slice(0, top);
  const shown = new Set(topHits.map((h) => h.item.key));
  const byScope = new Map<SearchScope, SearchHit[]>();
  for (const hit of hits) {
    const list = byScope.get(hit.item.scope) ?? [];
    list.push(hit);
    byScope.set(hit.item.scope, list);
  }

  const groups: HitGroup[] = [];
  for (const scope of scopes) {
    const all = byScope.get(scope.id);
    if (!all) continue;
    const rest = all.filter((h) => !shown.has(h.item.key));
    if (rest.length === 0) continue;
    groups.push({ scope, hits: rest.slice(0, perGroup), total: all.length });
  }
  groups.sort((a, b) => b.hits[0].score - a.hits[0].score);

  return { top: topHits, groups };
}

/** How many recent searches and recently opened results are kept. */
export const HISTORY_LIMIT = 8;
export const OPENED_LIMIT = 6;

/**
 * Put `entry` at the front of a most-recent-first list, dropping an earlier
 * copy (case-insensitively, so "Fuel" and "fuel" are one entry) and trimming.
 */
export function remember(list: readonly string[], entry: string, limit: number): string[] {
  const value = entry.trim();
  if (!value) return [...list];
  const lower = value.toLowerCase();
  return [value, ...list.filter((e) => e.toLowerCase() !== lower)].slice(0, limit);
}

/** Parse a stored history list, tolerating anything that isn't a string array. */
export function parseHistory(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}
