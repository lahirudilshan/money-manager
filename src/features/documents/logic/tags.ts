/**
 * Tags for a kept document, generated from its title and description.
 *
 * ## Why offline, not AI
 *
 * The point of a tag here is that the file is found later by a word the user
 * did not type when filing it: "passport" should surface under "identity",
 * "lease" under "property". A small topic dictionary does that instantly, on
 * a plane, with nothing leaving the phone — which matters for a folder of
 * passports and deeds. The user sees the suggestions as chips and can drop or
 * add any before saving, so a dictionary miss costs one tap.
 *
 * Tags are stored space-separated and lower case (same as health documents),
 * so a multi-word topic is hyphenated: "id-card" never splits into two.
 */

/** Topic → the words that imply it. Matched on whole (singularised) words. */
export const TOPICS: Record<string, readonly string[]> = {
  identity: ['passport', 'nic', 'identity', 'id', 'birth', 'citizenship', 'visa', 'licence', 'license', 'driving'],
  finance: ['invoice', 'receipt', 'bill', 'statement', 'bank', 'payslip', 'salary', 'payment', 'loan', 'cheque', 'account', 'epf', 'etf'],
  tax: ['tax', 'vat', 'tin', 'ird', 'return'],
  insurance: ['insurance', 'policy', 'premium', 'claim', 'cover', 'insured'],
  warranty: ['warranty', 'guarantee', 'serial', 'manual'],
  legal: ['contract', 'agreement', 'affidavit', 'will', 'court', 'legal', 'lawyer', 'notary', 'deed', 'lease'],
  property: ['deed', 'land', 'house', 'property', 'plan', 'survey', 'rent', 'lease', 'apartment', 'assessment'],
  vehicle: ['car', 'vehicle', 'bike', 'motorbike', 'van', 'revenue', 'registration', 'emission', 'tyre', 'service'],
  education: ['certificate', 'degree', 'diploma', 'transcript', 'exam', 'school', 'university', 'college', 'course', 'result'],
  health: ['medical', 'prescription', 'doctor', 'hospital', 'lab', 'clinic', 'vaccination', 'vaccine', 'scan', 'report'],
  travel: ['ticket', 'flight', 'booking', 'hotel', 'itinerary', 'boarding', 'airline', 'trip'],
  work: ['offer', 'employment', 'appointment', 'resignation', 'cv', 'resume', 'contract', 'experience', 'reference'],
  utilities: ['electricity', 'water', 'internet', 'broadband', 'phone', 'mobile', 'gas', 'ceb', 'leco', 'dialog', 'slt'],
  family: ['marriage', 'wedding', 'baby', 'child', 'kids', 'family'],
};

/** Words that never make a useful tag on their own. */
const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have in into is it its of on or that the this to was were will with ' +
    'my our your their his her me we you they i new old copy scan scanned photo image file document doc pdf ' +
    'page pages front back side final draft version v1 v2 img jpg jpeg png heic docx xlsx pptx txt ' +
    'about also all any can etc get got just more most not only other some such than then there these those ' +
    'very what when where which who why how one two three first second'
  ).split(' '),
);

/** Lower case words, letters and digits only. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * A crude singular, enough for a dictionary match: "receipts" → "receipt",
 * "policies" → "policy". Short words are left alone ("gas", "bus").
 */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The topics a set of words implies, in dictionary order. */
export function topicsFor(words: readonly string[]): string[] {
  const set = new Set(words.map(singular));
  return Object.entries(TOPICS)
    .filter(([topic, triggers]) => set.has(topic) || triggers.some((t) => set.has(t)))
    .map(([topic]) => topic);
}

function isYear(word: string): boolean {
  return /^(19|20)\d{2}$/.test(word);
}

function isKeyword(word: string): boolean {
  if (word.length < 3) return false;
  if (/^\d+$/.test(word)) return false;
  return !STOPWORDS.has(word);
}

/** Drop the extension and separators from a picked file's name. */
export function titleFromFileName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/(?<=\S)-(?=\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Suggest tags. Order: topics first (the words people search by but did not
 * write), then the title's own words, then a year, then description words
 * that recur or are distinctive. Capped, deduplicated, lower case.
 */
export function generateTags(
  { title, description, fileName }: { title?: string | null; description?: string | null; fileName?: string | null },
  max = 8,
): string[] {
  const titleWords = tokenize(title);
  const descWords = tokenize(description);
  const nameWords = title?.trim() ? [] : tokenize(titleFromFileName(fileName));
  const all = [...titleWords, ...descWords, ...nameWords];

  const out: string[] = [];
  const add = (tag: string) => {
    if (tag && !out.includes(tag) && out.length < max) out.push(tag);
  };

  for (const topic of topicsFor(all)) add(topic);
  for (const word of [...titleWords, ...nameWords]) if (isKeyword(word)) add(singular(word));
  const year = all.find(isYear);
  if (year) add(year);

  // Description words: those said more than once first, then the longest.
  const counts = new Map<string, number>();
  for (const word of descWords) {
    if (!isKeyword(word)) continue;
    const key = singular(word);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 4)
    .forEach(([word]) => add(word));

  return out;
}

/** Normalise free-typed tags: "Car, Insurance  2026" → ["car", "insurance", "2026"]. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const piece of raw.split(/[,\s]+/)) {
    const tag = piece
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/[^\p{L}\p{N}-]+/gu, '');
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The stored form: space-separated, or null when there are none. */
export function serialiseTags(tags: readonly string[]): string | null {
  const clean = parseTags(tags.join(' '));
  return clean.length > 0 ? clean.join(' ') : null;
}
