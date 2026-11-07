import { describe, expect, it } from 'vitest';
import {
  buildExplanationPrompt,
  combineExtractions,
  mergeExplanation,
  titleFromFileName,
  parseExtraction,
  unexplainedKeys,
  type TestWords,
} from '~/features/health/logic/labReports';
import {
  describeGeminiError,
  describeTiming,
  EXPLANATION_JSON_SCHEMA,
  EXTRACTION_JSON_SCHEMA,
  isThinkingConfigError,
  isTransientNetworkError,
  thinkingConfigFor,
} from '~/features/health/logic/gemini';

const extractionReply = {
  reports: [{ fileIndex: 0, title: 'Lipid profile', reportDate: '2026-03-14', labName: 'Asiri' }],
  results: [
    {
      fileIndex: 0,
      testKey: 'Total Cholesterol',
      testName: 'Total Cholesterol',
      category: 'Cholesterol & fats',
      value: 230,
      valueText: '230',
      unit: 'mg/dL',
      refLow: null,
      refHigh: 200,
      refText: '< 200',
      status: 'normal',
    },
    {
      fileIndex: 0,
      testKey: 'hdl_cholesterol',
      testName: 'HDL',
      value: 52,
      valueText: '52',
      unit: 'mg/dL',
      refLow: 40,
      refHigh: null,
      status: 'normal',
    },
  ],
};

const hdlWords: TestWords = {
  meaning: 'The good cholesterol.',
  ifHigh: 'Usually fine.',
  ifLow: 'May raise heart risk.',
  bodyArea: 'Heart and blood vessels',
  searchTerms: 'good cholesterol hdl',
};

describe('two-call analysis', () => {
  it('parses the extraction and rechecks status from the numbers', () => {
    const parsed = parseExtraction(extractionReply, 1)!;
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].testKey).toBe('total_cholesterol');
    expect(parsed.results[0].status).toBe('high');
    expect(parsed.results[0].meaning).toBeNull();
    expect(parsed.reports[0].labName).toBe('Asiri');
    expect(parseExtraction({ reports: [], results: [] }, 1)).toBeNull();
    expect(parseExtraction(null, 1)).toBeNull();
  });

  it('asks only for tests this phone has never explained', () => {
    const parsed = parseExtraction(extractionReply, 1)!;
    const known = new Map([['hdl_cholesterol', hdlWords]]);
    expect(unexplainedKeys(parsed.results, known)).toEqual(['total_cholesterol']);
    const prompt = buildExplanationPrompt({
      person: { name: 'Sam', age: 31 },
      results: parsed.results,
      unexplained: ['total_cholesterol'],
    });
    expect(prompt).toContain('Sam (31 years old)');
    expect(prompt).toContain('0. Total Cholesterol [total_cholesterol]: 230 mg/dL (range < 200) — high');
    expect(prompt).toContain('1. HDL [hdl_cholesterol]: 52 mg/dL (range 40+) — normal');
    expect(prompt).toContain('Explain these tests: total_cholesterol');
  });

  it('lays new and stored words over the numbers', () => {
    const parsed = parseExtraction(extractionReply, 1)!;
    const known = new Map([['hdl_cholesterol', hdlWords]]);
    const merged = mergeExplanation(
      parsed,
      {
        headline: 'Cholesterol is a little high',
        summary: 'Total cholesterol is above range.',
        condition: 'fair',
        areas: [{ area: 'Heart', status: 'watch', note: 'Cholesterol high' }],
        explanations: [
          { index: 0, explanation: 'Yours is above the top of the range.' },
          { index: 1, explanation: 'Yours is fine.' },
        ],
        tests: [
          {
            testKey: 'total_cholesterol',
            meaning: 'All the cholesterol in your blood.',
            ifHigh: 'Can clog blood vessels.',
            ifLow: 'Rarely a problem.',
            bodyArea: 'Heart and blood vessels',
            searchTerms: ['Cholesterol', 'fat', 'cholesterol'],
          },
        ],
      },
      known,
    );
    expect(merged.headline).toBe('Cholesterol is a little high');
    expect(merged.overall.condition).toBe('fair');
    expect(merged.results[0].meaning).toBe('All the cholesterol in your blood.');
    expect(merged.results[0].searchTerms).toBe('cholesterol fat');
    expect(merged.results[0].explanation).toBe('Yours is above the top of the range.');
    expect(merged.results[1].meaning).toBe('The good cholesterol.');
    expect(merged.results[1].explanation).toBe('Yours is fine.');
  });

  it('keeps the numbers when the explanation call failed', () => {
    const parsed = parseExtraction(extractionReply, 1)!;
    const merged = mergeExplanation(parsed, null, new Map([['hdl_cholesterol', hdlWords]]));
    expect(merged.results).toHaveLength(2);
    expect(merged.results[0].value).toBe(230);
    expect(merged.results[0].meaning).toBeNull();
    expect(merged.results[1].bodyArea).toBe('Heart and blood vessels');
    expect(merged.headline).toBe('Your reports have been read');
    expect(merged.overall.condition).toBe('unknown');
  });

  it('joins per-file reads, renumbering files and skipping failures', () => {
    const one = parseExtraction(extractionReply, 1)!;
    const joined = combineExtractions([
      { firstFile: 0, extraction: one },
      { firstFile: 6, extraction: null },
      { firstFile: 12, extraction: one },
    ])!;
    expect(joined.results.map((r) => r.fileIndex)).toEqual([0, 0, 12, 12]);
    expect(joined.reports.map((r) => r.fileIndex)).toEqual([0, 12]);
    expect(combineExtractions([{ firstFile: 0, extraction: null }])).toBeNull();
  });

  it('names an uploaded report after its file until it is read', () => {
    expect(titleFromFileName('FBC_Asiri-2026.03.pdf')).toBe('FBC Asiri 2026.03');
    expect(titleFromFileName('lipid profile 2026-03-14.PDF')).toBe('lipid profile 2026-03-14');
    expect(titleFromFileName('IMG_2041.HEIC')).toBe('IMG 2041');
    expect(titleFromFileName(null)).toBe('Lab report');
    expect(titleFromFileName('.pdf')).toBe('Lab report');
  });

  it('converts both schemas', () => {
    const props = EXTRACTION_JSON_SCHEMA.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(['reports', 'results']);
    expect(JSON.stringify(EXTRACTION_JSON_SCHEMA)).not.toContain('meaning');
    expect(JSON.stringify(EXPLANATION_JSON_SCHEMA)).not.toContain('nullable');
  });
});

describe('thinking and timing', () => {
  it('uses a budget on 2.5 and a level on later models', () => {
    expect(thinkingConfigFor('gemini-2.5-flash', 'extract')).toEqual({ thinkingBudget: 0 });
    // MINIMAL is refused by gemini-flash-latest with a 400.
    expect(thinkingConfigFor('gemini-flash-latest', 'extract')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingConfigFor('gemini-flash-lite-latest', 'explain')).toBeUndefined();
  });

  it('recognises a rejected thinking setting', () => {
    expect(isThinkingConfigError(400, 'thinking_level is not supported')).toBe(true);
    expect(isThinkingConfigError(400, 'bad schema')).toBe(false);
    expect(isThinkingConfigError(503, 'thinking overloaded')).toBe(false);
  });

  it('retries a dropped connection, not an HTTP error', () => {
    expect(isTransientNetworkError(0, 'fetch failed: The network connection was lost.')).toBe(true);
    expect(isTransientNetworkError(503, 'The network connection was lost.')).toBe(false);
    expect(isTransientNetworkError(0, 'App Check token is invalid')).toBe(false);
  });

  it('says plainly when the daily free limit is used up', () => {
    expect(
      describeGeminiError(429, 'Generate content requests per day limit exceeded on Free Tier'),
    ).toMatch(/Try again tomorrow/);
    expect(describeGeminiError(429, 'rate limit')).toMatch(/at its limit right now/);
  });

  it('says where the time went', () => {
    expect(
      describeTiming({
        firstChunkMs: 3100,
        totalMs: 14200,
        usage: { promptTokenCount: 2580, thoughtsTokenCount: 0, candidatesTokenCount: 1940 },
      }),
    ).toBe('Answered in 14.2s · first word 3.1s · in 2,580 · thinking 0 · out 1,940 tokens');
    expect(describeTiming({ firstChunkMs: null, totalMs: 900, usage: null })).toBe('Answered in 0.9s');
  });
});
