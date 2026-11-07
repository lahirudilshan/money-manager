import { describe, expect, it } from 'vitest';
import {
  canMoveInto,
  deepFileCounts,
  descendantIds,
  flattenTree,
  pathLabel,
} from '~/features/documents/logic/folders';
import { parseQuery, searchDocs, topTags, type SearchableDoc } from '~/features/documents/logic/search';
import {
  generateTags,
  parseTags,
  serialiseTags,
  titleFromFileName,
} from '~/features/documents/logic/tags';
import { extensionOf, fileKindOf, formatBytes } from '~/shared/lib/fileKinds';

const folders = [
  { id: 'car', parentId: null, name: 'Car' },
  { id: 'ins', parentId: 'car', name: 'Insurance' },
  { id: 'y26', parentId: 'ins', name: '2026' },
  { id: 'home', parentId: null, name: 'Home' },
];

function doc(partial: Partial<SearchableDoc> & { id: string; title: string }): SearchableDoc {
  return {
    folderId: null,
    description: null,
    tags: null,
    fileName: null,
    imageUri: null,
    pinned: false,
    createdAt: new Date(2026, 0, 1),
    ...partial,
  };
}

describe('generateTags', () => {
  it('adds the topic a word implies, which the user never typed', () => {
    expect(generateTags({ title: 'Passport copy' })).toEqual(['identity', 'passport']);
  });

  it('reads plurals and the description, and keeps a year', () => {
    const tags = generateTags({
      title: 'Toyota Aqua insurance',
      description: 'Comprehensive cover renewed March 2026, premium paid by card. Renewal every March.',
    });
    expect(tags[0]).toBe('insurance');
    expect(tags).toContain('toyota');
    expect(tags).toContain('2026');
    expect(tags).toContain('march');
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it('falls back to the file name when there is no title', () => {
    expect(generateTags({ fileName: 'house_lease-2025.pdf' })).toEqual(
      expect.arrayContaining(['legal', 'property', 'house', 'lease', '2025']),
    );
  });

  it('never suggests filler words', () => {
    expect(generateTags({ title: 'The scanned copy of my file' })).toEqual([]);
  });
});

describe('tag parsing', () => {
  it('normalises typed tags', () => {
    expect(parseTags('Car, #Insurance  2026,car')).toEqual(['car', 'insurance', '2026']);
    expect(serialiseTags([])).toBeNull();
    expect(serialiseTags(['A', 'b'])).toBe('a b');
  });

  it('turns a file name into a readable title', () => {
    expect(titleFromFileName('Bank_statement-March.pdf')).toBe('Bank statement March');
  });
});

describe('folder tree', () => {
  it('paths, descendants and the cycle guard', () => {
    expect(pathLabel(folders, 'y26')).toBe('Car / Insurance / 2026');
    expect(descendantIds(folders, 'car').sort()).toEqual(['ins', 'y26']);
    expect(canMoveInto(folders, 'car', 'y26')).toBe(false);
    expect(canMoveInto(folders, 'car', 'car')).toBe(false);
    expect(canMoveInto(folders, 'y26', 'home')).toBe(true);
    expect(canMoveInto(folders, 'y26', null)).toBe(true);
  });

  it('flattens depth-first, by name, and can hide a branch', () => {
    expect(flattenTree(folders).map((x) => `${x.depth}:${x.folder.name}`)).toEqual([
      '0:Car',
      '1:Insurance',
      '2:2026',
      '0:Home',
    ]);
    expect(flattenTree(folders, { exclude: 'ins' }).map((x) => x.folder.id)).toEqual(['car', 'home']);
  });

  it('survives a parent loop', () => {
    const loop = [
      { id: 'a', parentId: 'b', name: 'A' },
      { id: 'b', parentId: 'a', name: 'B' },
    ];
    expect(pathLabel(loop, 'a')).toBe('B / A');
  });

  it('counts files in subfolders too', () => {
    const counts = deepFileCounts(folders, [
      { id: '1', folderId: 'y26' },
      { id: '2', folderId: 'car' },
      { id: '3', folderId: null },
    ]);
    expect(counts.get('car')).toBe(2);
    expect(counts.get('ins')).toBe(1);
    expect(counts.get('home')).toBe(0);
  });
});

describe('searchDocs', () => {
  const docs = [
    doc({ id: 'policy', title: 'Aqua policy', folderId: 'y26', tags: 'insurance finance', fileName: 'policy.pdf' }),
    doc({ id: 'pass', title: 'Passport', tags: 'identity passport', fileName: 'IMG_1.jpg' }),
    doc({ id: 'lease', title: 'Lease', folderId: 'home', description: 'Signed with the landlord', fileName: 'lease.docx' }),
  ];

  it('matches every word, by prefix, across title, folder and tags', () => {
    expect(searchDocs(docs, folders, 'car ins').map((h) => h.doc.id)).toEqual(['policy']);
    expect(searchDocs(docs, folders, 'landl').map((h) => h.doc.id)).toEqual(['lease']);
    expect(searchDocs(docs, folders, 'car passport')).toEqual([]);
  });

  it('finds a file by the topic a word implies', () => {
    expect(searchDocs(docs, folders, 'visa').map((h) => h.doc.id)).toEqual(['pass']);
  });

  it('filters by kind words', () => {
    expect(parseQuery('car pdfs').kinds.has('pdf')).toBe(true);
    expect(searchDocs(docs, folders, 'photos').map((h) => h.doc.id)).toEqual(['pass']);
    expect(searchDocs(docs, folders, 'word').map((h) => h.doc.id)).toEqual(['lease']);
  });

  it('ranks a title hit above a description hit, and pinned first when empty', () => {
    const more = [...docs, doc({ id: 'pinned', title: 'Will', pinned: true, createdAt: new Date(2020, 0, 1) })];
    expect(searchDocs(more, folders, '')[0].doc.id).toBe('pinned');
    expect(searchDocs(docs, folders, 'aqua')[0].folderPath).toBe('Car / Insurance / 2026');
  });

  it('lists the most used tags', () => {
    expect(topTags([{ tags: 'a b' }, { tags: 'b c' }, { tags: null }], 2)).toEqual(['b', 'a']);
  });
});

describe('fileKinds', () => {
  it('reads kinds from names and stored references', () => {
    expect(fileKindOf('drive:abc|file:///x/1.PDF')).toBe('pdf');
    expect(fileKindOf('Budget.xlsx')).toBe('sheet');
    expect(fileKindOf('no-extension')).toBe('other');
    expect(extensionOf('file:///a.b/c')).toBe('');
    expect(formatBytes(2_500_000)).toBe('2.4 MB');
    expect(formatBytes(null)).toBeNull();
  });
});
