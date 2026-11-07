import { describe, expect, it } from 'vitest';
import {
  analyseProgress,
  expectedReadSeconds,
  formatElapsed,
  lockScreenDone,
  lockScreenFailed,
  lockScreenText,
  readPartialAnalysis,
} from '../analyseProgress';

describe('analyseProgress', () => {
  it('moves forward through the stages', () => {
    const a = analyseProgress({ stage: 'saving-files', done: 1, total: 2, pages: 2 });
    const b = analyseProgress({ stage: 'reading', done: 1, total: 2, pages: 2 });
    const c = analyseProgress({ stage: 'thinking', thinkingSeconds: 5, pages: 2 });
    const w = analyseProgress({ stage: 'writing', written: 3, pages: 2 });
    const d = analyseProgress({ stage: 'saving', done: 0, total: 10, pages: 2 });
    const e = analyseProgress({ stage: 'explaining', explainSeconds: 1, results: 10, pages: 2 });
    expect(d).toBeLessThan(e);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(w);
    expect(w).toBeLessThan(d);
  });

  it('counts pages prepared', () => {
    expect(analyseProgress({ stage: 'reading', done: 0, total: 4, pages: 4 })).toBeCloseTo(0.04);
    expect(analyseProgress({ stage: 'reading', done: 4, total: 4, pages: 4 })).toBeCloseTo(0.1);
  });

  it('reaches about 90% of the waiting stretch at the expected time', () => {
    const at = analyseProgress({
      stage: 'thinking',
      thinkingSeconds: expectedReadSeconds(2),
      pages: 2,
    });
    expect(at).toBeGreaterThan(0.1 + 0.35 * 0.88);
    expect(at).toBeLessThan(0.45);
  });

  it('never leaves the waiting stretch by waiting alone', () => {
    expect(analyseProgress({ stage: 'thinking', thinkingSeconds: 600, pages: 1 })).toBeLessThan(0.45);
  });

  it('moves forward with each item Gemini writes, without completing', () => {
    const at = (written: number) => analyseProgress({ stage: 'writing', written, pages: 1 });
    expect(at(0)).toBeCloseTo(0.45);
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(10)).toBeGreaterThan(at(5));
    expect(at(200)).toBeLessThanOrEqual(0.75);
  });

  it('hands over to the explanation once every result is saved', () => {
    expect(analyseProgress({ stage: 'saving', done: 12, total: 12, pages: 1 })).toBeCloseTo(0.8);
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(7)).toBe('0:07');
    expect(formatElapsed(72.9)).toBe('1:12');
  });
});

describe('readPartialAnalysis', () => {
  it('reads nothing from an answer that has not started', () => {
    expect(readPartialAnalysis('')).toEqual({ headline: null, reports: [], results: [] });
  });

  it('ignores a value still being written', () => {
    expect(readPartialAnalysis('{"headline": "Mostly norm').headline).toBeNull();
  });

  it('reads finished reports and results from a half-written answer', () => {
    const text =
      '{"headline":"Mostly normal","summary":"…","reports":[{"fileIndex":0,"title":"Full Blood Count"}],' +
      '"results":[{"fileIndex":0,"testKey":"hb","testName":"Haemoglobin","valueText":"13"},' +
      '{"fileIndex":0,"testName":"White cells","valueT';
    expect(readPartialAnalysis(text)).toEqual({
      headline: 'Mostly normal',
      reports: ['Full Blood Count'],
      results: ['Haemoglobin', 'White cells'],
    });
  });

  it('does not count a test name cut off mid-word', () => {
    const text = '{"reports":[],"results":[{"testName":"Haemoglobin"},{"testName":"Whi';
    expect(readPartialAnalysis(text).results).toEqual(['Haemoglobin']);
  });

  it('decodes escaped characters', () => {
    const text = '{"reports":[],"results":[{"testName":"HbA1c \\"glycated\\""}';
    expect(readPartialAnalysis(text).results).toEqual(['HbA1c "glycated"']);
  });
});

describe('lock screen text', () => {
  it('says time left while the pages are read, then the latest status', () => {
    const base = { personName: 'Amma', pages: 2, status: null };
    expect(lockScreenText({ ...base, stage: 'thinking', thinkingSeconds: 2 })).toEqual({
      title: 'Amma’s reports · step 1 of 2',
      subtitle: 'Gemini is reading 2 pages · about 15s left',
    });
    expect(lockScreenText({ ...base, stage: 'thinking', thinkingSeconds: 17 }).subtitle).toBe(
      'Gemini is reading 2 pages · almost there',
    );
    expect(lockScreenText({ ...base, stage: 'thinking', thinkingSeconds: 40 }).subtitle).toBe(
      'Gemini is reading 2 pages · longer than usual, still working',
    );
    expect(
      lockScreenText({
        ...base,
        stage: 'writing',
        thinkingSeconds: 0,
        status: '12 results found · HbA1c',
      }).subtitle,
    ).toBe('12 results found · HbA1c');
    expect(lockScreenText({ ...base, stage: 'saving', thinkingSeconds: 0 }).subtitle).toBe(
      'Saving to the health record',
    );
  });

  it('names the step and the time so far', () => {
    const base = { personName: 'Amma', pages: 2, status: null, thinkingSeconds: 0 };
    expect(lockScreenText({ ...base, stage: 'reading', elapsedSeconds: 7 }).title).toBe(
      'Amma’s reports · step 1 of 2 · 0:07',
    );
    expect(lockScreenText({ ...base, stage: 'explaining', elapsedSeconds: 65 })).toEqual({
      title: 'Amma’s results · step 2 of 2 · 1:05',
      subtitle: 'Results saved · writing them in simple words',
    });
    expect(
      lockScreenDone({ personName: 'Amma', results: 3, flagged: 0, elapsedSeconds: 48 }).title,
    ).toBe('Amma’s reports are ready in 0:48');
  });

  it('keeps the explanation step moving but never full', () => {
    const at = (explainSeconds: number) =>
      analyseProgress({ stage: 'explaining', explainSeconds, results: 10, pages: 1 });
    expect(at(0)).toBeCloseTo(0.8);
    expect(at(10)).toBeGreaterThan(at(5));
    expect(at(600)).toBeLessThan(1);
  });

  it('ends with what needs a look, or the first sentence of the error', () => {
    expect(lockScreenDone({ personName: 'James', results: 18, flagged: 3 })).toEqual({
      title: 'James’ reports are ready',
      subtitle: '18 results · 3 need a look',
    });
    expect(lockScreenDone({ personName: 'Amma', results: 1, flagged: 0 }).subtitle).toBe(
      '1 result · all in the normal range',
    );
    expect(
      lockScreenFailed({ personName: 'Amma', error: 'No connection. Check your internet.' })
        .subtitle,
    ).toBe('No connection.');
  });
});
