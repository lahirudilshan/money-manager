import { describe, expect, it } from 'vitest';
import {
  documentTitles,
  EXTRACTION_INSTRUCTION,
  simpleReportTitle,
  type ParsedResult,
} from '~/features/health/logic/labReports';

function result(fileIndex: number, category: string): ParsedResult {
  return {
    fileIndex,
    testKey: 'x',
    testName: 'X',
    category,
    value: 1,
    valueText: '1',
    unit: null,
    refLow: null,
    refHigh: null,
    refText: null,
    status: 'normal',
    meaning: null,
    ifHigh: null,
    ifLow: null,
    bodyArea: null,
    explanation: null,
    searchTerms: '',
  };
}

describe('simpleReportTitle', () => {
  it('keeps a good short title', () => {
    expect(simpleReportTitle('Lipid profile')).toBe('Lipid profile');
  });

  it('rejects generic titles', () => {
    for (const t of ['Lab report', 'LABORATORY REPORT', 'Test Results', 'Report', '  ', null]) {
      expect(simpleReportTitle(t)).toBeNull();
    }
  });

  it('drops the lab name tacked on', () => {
    expect(simpleReportTitle('Lipid profile - Asiri Labs', 'Asiri Labs')).toBe('Lipid profile');
    expect(simpleReportTitle('Lipid profile · Asiri Labs', 'asiri labs')).toBe('Lipid profile');
  });

  it('turns a shouted title into sentence case', () => {
    expect(simpleReportTitle('FULL BLOOD COUNT')).toBe('Full blood count');
  });

  it('caps a long title at a word boundary', () => {
    const t = simpleReportTitle('Comprehensive metabolic panel with liver and kidney markers');
    expect(t!.length).toBeLessThanOrEqual(40);
    expect(t).toBe('Comprehensive metabolic panel with liver');
  });
});

describe('documentTitles', () => {
  it('gives every file a name', () => {
    const titles = documentTitles(
      {
        reports: [
          { fileIndex: 0, title: 'Full blood count', reportDate: null, labName: null },
          { fileIndex: 2, title: 'Lab report', reportDate: null, labName: null },
        ],
        results: [result(0, 'Blood count'), result(2, 'Thyroid'), result(2, 'Thyroid')],
      },
      4,
    );
    // 1: no entry, no results → continuation of 0. 2: generic → from its results.
    // 3: nothing → continuation of 2.
    expect(titles).toEqual(['Full blood count', 'Full blood count', 'Thyroid test', 'Thyroid test']);
  });

  it('falls back to "Lab report" when nothing was read', () => {
    expect(documentTitles({ reports: [], results: [] }, 1)).toEqual(['Lab report']);
  });

  it('tells the model to name the test, not the lab', () => {
    expect(EXTRACTION_INSTRUCTION).toMatch(/One entry per FILE/);
    expect(EXTRACTION_INSTRUCTION).toMatch(/NEVER be the lab or hospital name/);
  });
});
