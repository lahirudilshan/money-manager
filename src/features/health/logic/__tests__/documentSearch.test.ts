import { describe, expect, it } from 'vitest';
import {
  describeQuery,
  mergeTags,
  parseDocumentQuery,
  reportTopics,
  searchDocuments,
  tagsFromResults,
  type SearchableDocument,
} from '~/features/health/logic/documentSearch';

// 15 Jun 2026, mid-afternoon.
const NOW = new Date(2026, 5, 15, 15, 0);

const doc = (p: Partial<SearchableDocument> & { id: string; documentDate: Date }): SearchableDocument => ({
  title: 'Lab report',
  kind: 'report',
  summary: null,
  note: null,
  tags: '',
  ...p,
});

const DOCS = [
  doc({ id: 'sugar-may', documentDate: new Date(2026, 4, 10), tags: 'fasting blood glucose sugar diabetes' }),
  doc({ id: 'sugar-jan', documentDate: new Date(2026, 0, 20), tags: 'hba1c sugar' }),
  doc({ id: 'lipid-apr', documentDate: new Date(2026, 3, 2), tags: 'ldl cholesterol lipid' }),
  doc({ id: 'rx-jun', documentDate: new Date(2026, 5, 1), kind: 'prescription', title: 'Metformin' }),
  doc({ id: 'sugar-2025', documentDate: new Date(2025, 8, 9), tags: 'glucose' }),
];

const ids = (q: string) => searchDocuments(DOCS, parseDocumentQuery(q, NOW)).map((d) => d.id);

describe('reading the question', () => {
  it('reads "last 3 months sugar reports"', () => {
    const q = parseDocumentQuery('last 3 months sugar reports', NOW);
    expect(q.from).toEqual(new Date(2026, 2, 15));
    expect(q.kinds).toEqual(['report']);
    expect(q.topics[0][0]).toBe('sugar');
    expect(q.topics[0]).toContain('glucose');
    expect(q.periodLabel).toBe('the last 3 months');
  });

  it('tolerates "last 3 month" and word numbers', () => {
    expect(parseDocumentQuery('last 3 month', NOW).from).toEqual(new Date(2026, 2, 15));
    expect(parseDocumentQuery('past two weeks', NOW).from).toEqual(new Date(2026, 5, 1));
    expect(parseDocumentQuery('last month', NOW).from).toEqual(new Date(2026, 4, 15));
  });

  it('reads calendar phrases', () => {
    const year = parseDocumentQuery('reports in 2025', NOW);
    expect(year.from).toEqual(new Date(2025, 0, 1));
    expect(year.to).toEqual(new Date(2026, 0, 1));

    const month = parseDocumentQuery('march', NOW);
    expect(month.from).toEqual(new Date(2026, 2, 1));
    expect(month.to).toEqual(new Date(2026, 3, 1));

    // A month later in the year than now means last year's.
    expect(parseDocumentQuery('september', NOW).from).toEqual(new Date(2025, 8, 1));
    expect(parseDocumentQuery('since january', NOW).from).toEqual(new Date(2026, 0, 1));
    expect(parseDocumentQuery('this year', NOW).from).toEqual(new Date(2026, 0, 1));
  });
});

describe('finding reports', () => {
  it('answers the headline question', () => {
    expect(ids('last 3 months sugar reports')).toEqual(['sugar-may']);
  });

  it('finds by topic synonym, newest first', () => {
    expect(ids('sugar')).toEqual(['sugar-may', 'sugar-jan', 'sugar-2025']);
    expect(ids('cholesterol')).toEqual(['lipid-apr']);
  });

  it('filters by kind and by year', () => {
    expect(ids('prescriptions')).toEqual(['rx-jun']);
    expect(ids('sugar 2025')).toEqual(['sugar-2025']);
  });

  it('needs every topic to match', () => {
    expect(ids('sugar cholesterol')).toEqual([]);
  });

  it('describes what it understood', () => {
    expect(
      describeQuery(parseDocumentQuery('last 3 months sugar reports', NOW), (k) => `${k}s`),
    ).toBe('“sugar” · reports · the last 3 months');
  });
});

describe('tags', () => {
  it('builds tags from what the AI read', () => {
    const tags = tagsFromResults([
      { testName: 'Fasting Plasma Glucose', category: 'Blood sugar', bodyArea: 'Pancreas', searchTerms: 'sugar diabetes' },
    ]);
    expect(tags.split(' ')).toEqual(
      expect.arrayContaining(['fasting', 'glucose', 'blood', 'sugar', 'pancreas', 'diabetes']),
    );
  });

  it('merges tag lists without duplicates', () => {
    expect(mergeTags('sugar diabetes', 'Sugar, kidney', null)).toBe('sugar diabetes kidney');
  });
});

describe('report topics', () => {
  it('names a report by its categories, off-range first', () => {
    expect(
      reportTopics(
        [
          { category: 'Cholesterol & fats', status: 'normal' },
          { category: 'Cholesterol & fats', status: 'high' },
          { category: 'Blood sugar', status: 'normal' },
          { category: 'Other', status: 'normal' },
        ],
        null,
      ),
    ).toEqual([
      { label: 'Cholesterol & fats', flagged: true },
      { label: 'Blood sugar', flagged: false },
    ]);
  });

  it('falls back to tags when the AI has not read it', () => {
    expect(reportTopics([], 'sugar annual')).toEqual([
      { label: 'Sugar', flagged: false },
      { label: 'Annual', flagged: false },
    ]);
  });
});
