import { describe, expect, it } from 'vitest';
import { availableScopes, countByScope, groupHits, searchAll, type SearchItem } from '../globalSearch';

const items: SearchItem[] = [
  { key: 't1', scope: 'transactions', title: 'Fuel', subtitle: 'LKR 12,500 · Dec 3', details: ['12500'], route: '/a', date: new Date(2026, 11, 3) },
  { key: 't2', scope: 'transactions', title: 'Fuel', subtitle: 'LKR 9,000 · Nov 2', route: '/b', date: new Date(2026, 10, 2) },
  { key: 'b1', scope: 'bills', title: 'Electricity', subtitle: 'Utilities', route: '/c' },
  { key: 'd1', scope: 'documents', title: 'Passport', details: ['identity travel'], route: '/d' },
  { key: 'v1', scope: 'vehicles', title: 'Car', subtitle: 'CAB-1234', details: ['fuel petrol'], route: '/e' },
];

describe('searchAll', () => {
  it('returns nothing for an empty query', () => {
    expect(searchAll(items, '  ')).toEqual([]);
  });

  it('ranks a title match above a details match, newer first on a tie', () => {
    expect(searchAll(items, 'fuel').map((h) => h.item.key)).toEqual(['t1', 't2', 'v1']);
  });

  it('requires every word, by prefix', () => {
    expect(searchAll(items, 'fuel dec').map((h) => h.item.key)).toEqual(['t1']);
  });

  it('matches amounts and details', () => {
    expect(searchAll(items, '12500').map((h) => h.item.key)).toEqual(['t1']);
    expect(searchAll(items, 'ident').map((h) => h.item.key)).toEqual(['d1']);
  });

  it('limits to a scope', () => {
    expect(searchAll(items, 'fuel', 'vehicles').map((h) => h.item.key)).toEqual(['v1']);
  });

  it('counts hits per scope', () => {
    const counts = countByScope(searchAll(items, 'fuel'));
    expect(counts.get('transactions')).toBe(2);
    expect(counts.get('vehicles')).toBe(1);
  });
});

describe('availableScopes', () => {
  it('shows core scopes always and add-on scopes only when enabled', () => {
    const ids = availableScopes(new Set(['documents'])).map((s) => s.id);
    expect(ids).toContain('transactions');
    expect(ids).toContain('documents');
    expect(ids).not.toContain('vehicles');
    expect(ids).not.toContain('health');
  });
});

describe('relevance', () => {
  const now = new Date(2026, 11, 10).getTime();
  const pool: SearchItem[] = [
    { key: 'long', scope: 'bills', title: 'Fuel for the generator', route: '/' },
    { key: 'exact', scope: 'bills', title: 'Fuel', route: '/' },
    { key: 'detail', scope: 'sms', title: 'Lanka IOC', details: ['fuel station'], route: '/' },
  ];

  it('puts an exact title first, a details-only hit last', () => {
    expect(searchAll(pool, 'fuel', null, now).map((h) => h.item.key)).toEqual(['exact', 'long', 'detail']);
  });
});

describe('groupHits', () => {
  it('lifts top matches out and orders sections by their best hit', async () => {
    const { SCOPES } = await import('../globalSearch');
    const hits = searchAll(items, 'fuel');
    const { top, groups } = groupHits(hits, SCOPES, { top: 1, perGroup: 4 });
    expect(top.map((h) => h.item.key)).toEqual(['t1']);
    expect(groups.map((g) => g.scope.id)).toEqual(['transactions', 'vehicles']);
    expect(groups[0].hits.map((h) => h.item.key)).toEqual(['t2']);
    expect(groups[0].total).toBe(2);
  });
});

describe('history', () => {
  it('moves a repeat to the front, case-insensitively, and trims', async () => {
    const { remember } = await import('../globalSearch');
    expect(remember(['fuel', 'rent', 'car'], 'Fuel', 3)).toEqual(['Fuel', 'rent', 'car']);
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(remember(['a'], '  ', 3)).toEqual(['a']);
  });

  it('tolerates a bad stored value', async () => {
    const { parseHistory } = await import('../globalSearch');
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('["x", 3]')).toEqual(['x']);
    expect(parseHistory(undefined)).toEqual([]);
  });
});
