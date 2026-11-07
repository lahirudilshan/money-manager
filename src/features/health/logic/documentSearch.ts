/**
 * Finding a report by asking for it — "last 3 months sugar reports" — offline.
 *
 * ## Why not AI
 *
 * The question has a fixed shape: a TIME window ("last 3 months", "in 2025",
 * "since March"), a KIND of paper ("reports", "prescriptions"), and a TOPIC
 * ("sugar", "cholesterol"). All three can be read with rules, and the topic is
 * matched against tags written onto each report when it was filed (the AI's
 * test names, categories and everyday search words). So the answer is instant,
 * works with no signal, costs nothing, and can never invent a report.
 *
 * Pure — no database, no React — so the parser is tested.
 */

import { SYNONYMS, words } from './labReports';

export type DocumentKindKey =
  | 'prescription'
  | 'report'
  | 'scan'
  | 'bill'
  | 'insurance'
  | 'vaccination'
  | 'other';

/** What a question was read as. */
export interface DocumentQuery {
  /** Inclusive start of the time window, or null for "any time". */
  from: Date | null;
  /** Exclusive end of the window, or null for "until now". */
  to: Date | null;
  /** A plain description of the window, for the "Showing …" line. */
  periodLabel: string | null;
  kinds: DocumentKindKey[];
  /** Topic words, each with its synonyms — every group must match. */
  topics: string[][];
}

/** The fields a document is matched on. */
export interface SearchableDocument {
  id: string;
  title: string;
  kind: DocumentKindKey;
  documentDate: Date;
  summary: string | null;
  note: string | null;
  /** Space-separated tags: user-added and AI-derived. */
  tags: string;
}

/** Words that name a kind of paper, singular and plural. */
const KIND_WORDS: Record<string, DocumentKindKey> = {
  report: 'report',
  reports: 'report',
  lab: 'report',
  labs: 'report',
  test: 'report',
  tests: 'report',
  result: 'report',
  results: 'report',
  prescription: 'prescription',
  prescriptions: 'prescription',
  scan: 'scan',
  scans: 'scan',
  xray: 'scan',
  mri: 'scan',
  ultrasound: 'scan',
  bill: 'bill',
  bills: 'bill',
  receipt: 'bill',
  receipts: 'bill',
  insurance: 'insurance',
  vaccination: 'vaccination',
  vaccinations: 'vaccination',
  vaccine: 'vaccination',
  vaccines: 'vaccination',
};

/** Filler that carries no meaning in a search for paper. */
const FILLER = new Set(
  (
    'show me my the a an of for and or in on at from to with all any find get give list ' +
    'what which where is are was were have has had do did please documents document files ' +
    'file papers paper level levels'
  ).split(' '),
);

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** A month name or its three-letter form → 0–11. */
function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return MONTHS.findIndex((m) => m === word || m.startsWith(word));
}

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 0, year: 0 };

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function singular(word: string): string {
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

/**
 * Read a question into a time window, kinds and topics.
 *
 * Time phrases understood:
 *   last|past N days|weeks|months|years   ("last 3 month" works too)
 *   last|past week|month|year             (= the last one of them)
 *   this week|month|year, today, yesterday, recent|recently (= 3 months)
 *   in|during 2025, in March [2025], since March|2025, March 2025
 */
export function parseDocumentQuery(query: string, now: Date): DocumentQuery {
  const tokens = words(query);
  const used = new Set<number>();
  let from: Date | null = null;
  let to: Date | null = null;
  let periodLabel: string | null = null;

  const take = (...indexes: number[]) => indexes.forEach((i) => used.add(i));
  const today = startOfDay(now);

  for (let i = 0; i < tokens.length && !periodLabel; i += 1) {
    const word = tokens[i];
    const next = tokens[i + 1];
    const after = tokens[i + 2];

    if ((word === 'last' || word === 'past') && next) {
      const n = /^\d+$/.test(next) ? Number(next) : NUMBER_WORDS[next];
      const unitWord = n ? after : next;
      const unit = unitWord ? singular(unitWord) : '';
      if (unit in UNIT_DAYS) {
        const count = n ?? 1;
        from = new Date(today);
        if (unit === 'month') from.setMonth(from.getMonth() - count);
        else if (unit === 'year') from.setFullYear(from.getFullYear() - count);
        else from.setDate(from.getDate() - count * UNIT_DAYS[unit]);
        periodLabel = `the last ${count === 1 ? unit : `${count} ${unit}s`}`;
        take(i, i + 1, ...(n ? [i + 2] : []));
        continue;
      }
    }

    if (word === 'this' && next && ['week', 'month', 'year'].includes(next)) {
      from =
        next === 'year'
          ? new Date(now.getFullYear(), 0, 1)
          : next === 'month'
            ? new Date(now.getFullYear(), now.getMonth(), 1)
            : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      periodLabel = `this ${next}`;
      take(i, i + 1);
      continue;
    }

    if (word === 'today' || word === 'yesterday') {
      from = word === 'today' ? today : new Date(today.getTime() - 86_400_000);
      to = word === 'today' ? null : today;
      periodLabel = word;
      take(i);
      continue;
    }

    if (word === 'recent' || word === 'recently' || word === 'latest' || word === 'new') {
      from = new Date(today);
      from.setMonth(from.getMonth() - 3);
      periodLabel = 'the last 3 months';
      take(i);
      continue;
    }

    // "since March", "since 2025"
    if (word === 'since' && next) {
      const m = monthIndex(next);
      if (/^(19|20)\d{2}$/.test(next)) {
        from = new Date(Number(next), 0, 1);
        periodLabel = `since ${next}`;
        take(i, i + 1);
        continue;
      }
      if (m >= 0) {
        const year = m > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
        from = new Date(year, m, 1);
        periodLabel = `since ${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)}`;
        take(i, i + 1);
        continue;
      }
    }

    // "2025", "in 2025"
    if (/^(19|20)\d{2}$/.test(word)) {
      const year = Number(word);
      // "March 2025" is handled by the month branch below via lookbehind.
      const prevMonth = i > 0 ? monthIndex(tokens[i - 1]) : -1;
      if (prevMonth < 0) {
        from = new Date(year, 0, 1);
        to = new Date(year + 1, 0, 1);
        periodLabel = `in ${year}`;
        take(i);
        if (tokens[i - 1] === 'in' || tokens[i - 1] === 'during') take(i - 1);
        continue;
      }
    }

    // "March", "in March", "March 2025"
    const m = monthIndex(word);
    if (m >= 0 && (word.length >= 4 || word === 'may' || word === 'mar' || word === 'jan')) {
      const explicitYear = next && /^(19|20)\d{2}$/.test(next) ? Number(next) : null;
      const year =
        explicitYear ?? (m > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
      from = new Date(year, m, 1);
      to = new Date(year, m + 1, 1);
      periodLabel = `in ${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${year}`;
      take(i, ...(explicitYear ? [i + 1] : []));
      if (tokens[i - 1] === 'in' || tokens[i - 1] === 'during') take(i - 1);
      continue;
    }
  }

  const kinds = new Set<DocumentKindKey>();
  const topics: string[][] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    if (used.has(i)) continue;
    const word = tokens[i];
    const pair = `${word} ${tokens[i + 1] ?? ''}`.trim();

    if (SYNONYMS[pair]) {
      topics.push([pair, ...SYNONYMS[pair]]);
      i += 1;
      continue;
    }
    if (KIND_WORDS[word]) {
      kinds.add(KIND_WORDS[word]);
      continue;
    }
    if (FILLER.has(word) || word.length < 2 || /^\d+$/.test(word)) continue;
    topics.push([word, ...(SYNONYMS[word] ?? SYNONYMS[singular(word)] ?? [])]);
  }

  return { from, to, periodLabel, kinds: [...kinds], topics };
}

function haystack(doc: SearchableDocument): string {
  return ` ${words(`${doc.title} ${doc.kind} ${doc.summary ?? ''} ${doc.note ?? ''} ${doc.tags}`).join(' ')} `;
}

function matchesTopic(text: string, alternatives: readonly string[]): boolean {
  return alternatives.some(
    (alt) => text.includes(` ${alt} `) || (alt.length >= 4 && !alt.includes(' ') && text.includes(` ${alt}`)),
  );
}

/**
 * Filter documents by a parsed question, newest first.
 *
 * Every topic must match (so "sugar cholesterol" means both), the date must
 * fall in the window, and the kind must be one asked for when any was named.
 */
export function searchDocuments<D extends SearchableDocument>(
  documents: readonly D[],
  query: DocumentQuery,
): D[] {
  return documents
    .filter((doc) => {
      const at = doc.documentDate.getTime();
      if (query.from && at < query.from.getTime()) return false;
      if (query.to && at >= query.to.getTime()) return false;
      if (query.kinds.length > 0 && !query.kinds.includes(doc.kind)) return false;
      if (query.topics.length === 0) return true;
      const text = haystack(doc);
      return query.topics.every((alternatives) => matchesTopic(text, alternatives));
    })
    .sort((a, b) => b.documentDate.getTime() - a.documentDate.getTime());
}

/** A human line describing what a query was read as. */
export function describeQuery(query: DocumentQuery, kindLabel: (k: DocumentKindKey) => string): string {
  const parts: string[] = [];
  if (query.topics.length > 0) parts.push(query.topics.map((t) => `“${t[0]}”`).join(' + '));
  if (query.kinds.length > 0) parts.push(query.kinds.map(kindLabel).join(' or ').toLowerCase());
  if (query.periodLabel) parts.push(query.periodLabel);
  return parts.join(' · ');
}

/**
 * Tags for a report, built from what the AI read off it.
 *
 * Test names, their categories, body areas and the everyday search words —
 * deduplicated and lowercased, so "sugar" finds a report that only ever said
 * "Fasting Plasma Glucose".
 */
export function tagsFromResults(
  results: readonly { testName: string; category: string; bodyArea: string | null; searchTerms: string }[],
): string {
  const tags = new Set<string>();
  for (const r of results) {
    for (const part of [r.testName, r.category, r.bodyArea ?? '', r.searchTerms]) {
      for (const word of words(part)) if (word.length >= 2) tags.add(word);
    }
  }
  return [...tags].join(' ');
}

/** Merge tag strings, keeping order and dropping duplicates. */
export function mergeTags(...lists: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  for (const list of lists) for (const word of words(list ?? '')) seen.add(word);
  return [...seen].join(' ');
}

/** Ready-made questions shown under the search box. */
export const EXAMPLE_QUESTIONS = [
  'Last 3 months sugar reports',
  'Cholesterol reports this year',
  'Prescriptions last month',
  'Reports since January',
];

/** What a report is about: a category, and whether anything in it was off. */
export interface ReportTopic {
  label: string;
  flagged: boolean;
}

/**
 * The topics of one report, from what the AI read off it.
 *
 * Categories rather than individual tests — "Blood sugar", "Kidney" — because
 * a lipid panel is five tests and one topic, and five chips on a timeline row
 * is noise. A topic is flagged when any of its tests were out of range, and
 * flagged topics lead. Falls back to the report's own tags when the AI has
 * not read it.
 */
export function reportTopics(
  results: readonly { category: string; status: string }[],
  tags: string | null | undefined,
  limit = 3,
): ReportTopic[] {
  if (results.length > 0) {
    const byCategory = new Map<string, boolean>();
    for (const r of results) {
      const off = ['low', 'high', 'abnormal', 'borderline'].includes(r.status);
      byCategory.set(r.category, (byCategory.get(r.category) ?? false) || off);
    }
    return [...byCategory.entries()]
      .filter(([label]) => label !== 'Other' || byCategory.size === 1)
      .map(([label, flagged]) => ({ label, flagged }))
      .sort((a, b) => Number(b.flagged) - Number(a.flagged))
      .slice(0, limit);
  }
  return words(tags ?? '')
    .slice(0, limit)
    .map((tag) => ({ label: tag[0].toUpperCase() + tag.slice(1), flagged: false }));
}
