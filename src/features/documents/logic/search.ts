/**
 * Quick search over kept documents — the same function the home screen's
 * search box and the add-on's own search use.
 *
 * Every word typed must match something about a file (AND, by prefix), so
 * typing more narrows rather than widens: "car ins" finds the insurance
 * policy in the Car folder. A word can match the title, a tag, the folder
 * path, the original file name or the description — weighted in that order,
 * because a hit in the title is what the user most likely meant.
 *
 * Two kinds of word are understood rather than matched:
 *   - a file kind ("pdf", "photos", "excel") filters by type;
 *   - a topic trigger ("passport") also matches its topic tag ("identity"),
 *     so a file tagged by `generateTags` is found by the word it implies.
 */

import { extensionOf, fileKindOf, type FileKind } from '~/shared/lib/fileKinds';
import { pathLabel, type FolderLike } from './folders';
import { singular, tokenize, TOPICS } from './tags';

export interface SearchableDoc {
  id: string;
  folderId: string | null;
  title: string;
  description: string | null;
  tags: string | null;
  fileName: string | null;
  imageUri: string | null;
  pinned: boolean;
  createdAt: Date;
}

export interface DocHit<D extends SearchableDoc> {
  doc: D;
  score: number;
  /** "Car / Insurance", or '' at the top level. */
  folderPath: string;
}

const KIND_WORDS: Record<string, FileKind> = {
  pdf: 'pdf',
  pdfs: 'pdf',
  photo: 'image',
  photos: 'image',
  image: 'image',
  images: 'image',
  picture: 'image',
  pictures: 'image',
  pic: 'image',
  pics: 'image',
  word: 'doc',
  docx: 'doc',
  excel: 'sheet',
  spreadsheet: 'sheet',
  spreadsheets: 'sheet',
  xlsx: 'sheet',
  csv: 'sheet',
  video: 'video',
  videos: 'video',
};

/** The kind of a stored file, from the original name first, then the stored path. */
export function kindOfDoc(doc: Pick<SearchableDoc, 'fileName' | 'imageUri'>): FileKind {
  return fileKindOf(extensionOf(doc.fileName) ? doc.fileName : doc.imageUri);
}

/** A query split into words to match and kinds to filter by. */
export function parseQuery(query: string): { words: string[]; kinds: Set<FileKind> } {
  const words: string[] = [];
  const kinds = new Set<FileKind>();
  for (const token of tokenize(query)) {
    const kind = KIND_WORDS[token];
    if (kind) kinds.add(kind);
    else words.push(token);
  }
  return { words, kinds };
}

/** The topics a query word stands for: "passports" → ["identity"]. */
function topicsOfWord(word: string): string[] {
  const s = singular(word);
  return Object.entries(TOPICS)
    .filter(([, triggers]) => triggers.includes(s) || triggers.includes(word))
    .map(([topic]) => topic);
}

function prefixHit(haystack: readonly string[], needle: string): boolean {
  return haystack.some((w) => w.startsWith(needle) || singular(w) === singular(needle));
}

/**
 * Rank documents against a query. An empty query returns everything, pinned
 * first, then newest — what the home screen shows before anything is typed.
 */
export function searchDocs<D extends SearchableDoc>(
  docs: readonly D[],
  folders: readonly FolderLike[],
  query: string,
): DocHit<D>[] {
  const { words, kinds } = parseQuery(query);
  const hits: DocHit<D>[] = [];

  for (const doc of docs) {
    if (kinds.size > 0 && !kinds.has(kindOfDoc(doc))) continue;

    const folderPath = pathLabel(folders, doc.folderId);
    const fields = {
      title: tokenize(doc.title),
      tags: (doc.tags ?? '').split(' ').filter(Boolean),
      folder: tokenize(folderPath),
      file: tokenize(doc.fileName),
      description: tokenize(doc.description),
    };

    let score = 0;
    let matchedAll = true;
    for (const word of words) {
      let best = 0;
      if (prefixHit(fields.title, word)) best = Math.max(best, 5);
      if (prefixHit(fields.tags, word)) best = Math.max(best, 4);
      if (topicsOfWord(word).some((t) => fields.tags.includes(t))) best = Math.max(best, 3);
      if (prefixHit(fields.folder, word)) best = Math.max(best, 3);
      if (prefixHit(fields.file, word)) best = Math.max(best, 2);
      if (prefixHit(fields.description, word)) best = Math.max(best, 1);
      if (best === 0) {
        matchedAll = false;
        break;
      }
      score += best;
    }
    if (!matchedAll) continue;

    hits.push({ doc, score: score + (doc.pinned ? 1 : 0), folderPath });
  }

  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.doc.pinned) - Number(a.doc.pinned) ||
      b.doc.createdAt.getTime() - a.doc.createdAt.getTime(),
  );
}

/** The most used tags across documents, for one-tap filter chips. */
export function topTags(docs: readonly Pick<SearchableDoc, 'tags'>[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    for (const tag of (doc.tags ?? '').split(' ').filter(Boolean)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}
