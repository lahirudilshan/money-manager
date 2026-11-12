import { describe, expect, it } from 'vitest';
import { rangeBands } from '../labReports';
import { reportFindingText, summariseReports } from '../reportList';

describe('summariseReports', () => {
  const analyses = [
    {
      id: 'a1',
      reportDate: new Date('2026-11-05'),
      headline: 'A few things to check.',
      overallJson: '{"condition":"fair"}',
    },
    { id: 'a2', reportDate: new Date('2026-10-01'), headline: 'All good.', overallJson: '{}' },
  ];
  const results = [
    { analysisId: 'a1', category: 'Blood count', status: 'normal' },
    { analysisId: 'a1', category: 'Blood sugar', status: 'high' },
    { analysisId: 'a1', category: 'Blood count', status: 'low' },
    { analysisId: 'a2', category: 'Kidney', status: 'normal' },
  ];

  it('counts results and flags per report, keeping order', () => {
    const [first, second] = summariseReports(analyses, results);
    expect(first).toMatchObject({ id: 'a1', total: 3, flagged: 2, condition: 'fair' });
    expect(second).toMatchObject({ id: 'a2', total: 1, flagged: 0, condition: 'unknown' });
  });

  it('names the topics, out-of-range first', () => {
    const [first] = summariseReports(analyses, results);
    expect(first.topics.map((t) => t.label)).toEqual(['Blood count', 'Blood sugar']);
    expect(first.topics.every((t) => t.flagged)).toBe(true);
  });
});

describe('reportFindingText', () => {
  it('says it in plain words', () => {
    expect(reportFindingText({ total: 3, flagged: 0 })).toBe('All 3 tests normal');
    expect(reportFindingText({ total: 1, flagged: 0 })).toBe('Result normal');
    expect(reportFindingText({ total: 9, flagged: 2 })).toBe('2 of 9 tests to check');
    expect(reportFindingText({ total: 0, flagged: 0 })).toBe('No test results saved');
  });
});

describe('rangeBands', () => {
  it('splits a two-sided range into three zones', () => {
    expect(rangeBands(70, 100, 'mg/dL')).toEqual({
      low: 'Under 70 mg/dL',
      normal: '70–100 mg/dL',
      high: 'Over 100 mg/dL',
    });
  });

  it('leaves out the zone a one-sided range does not define', () => {
    expect(rangeBands(null, 6, 'mg/l')).toEqual({ low: null, normal: 'Under 6 mg/l', high: 'Over 6 mg/l' });
    expect(rangeBands(90, null, null)).toEqual({ low: 'Under 90', normal: 'Over 90', high: null });
  });

  it('has nothing to say without a range', () => {
    expect(rangeBands(null, null, 'fL')).toBeNull();
  });
});
