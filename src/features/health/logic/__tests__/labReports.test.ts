import { describe, expect, it } from 'vitest';
import {
  deriveStatus,
  groupByTest,
  normaliseTestKey,
  parseAnalysis,
  parseReportDate,
  queryTerms,
  rangePosition,
  readOverall,
  reportDateFor,
  searchLabResults,
  suggestedQuestions,
  type LabResultLike,
} from '~/features/health/logic/labReports';
import {
  analysesToday,
  ANALYSIS_JSON_SCHEMA,
  appCheckExpiry,
  describeGeminiError,
  parseJsonText,
  statusFromError,
  toJsonSchema,
  worthAnotherModel,
} from '~/features/health/logic/gemini';

function row(
  partial: Partial<LabResultLike> & { testKey: string; testName: string },
): LabResultLike {
  return {
    id: `${partial.testKey}-${partial.measuredAt?.getTime() ?? 0}`,
    category: 'Other',
    value: 100,
    valueText: '100',
    unit: 'mg/dL',
    refLow: 70,
    refHigh: 110,
    status: 'normal',
    searchTerms: '',
    bodyArea: null,
    measuredAt: new Date(2026, 0, 1),
    ...partial,
  };
}

describe('deriveStatus', () => {
  it('trusts arithmetic over the model when there is a range', () => {
    expect(deriveStatus(126, 70, 100, 'normal')).toBe('high');
    expect(deriveStatus(9, 12, 16, 'normal')).toBe('low');
    expect(deriveStatus(90, 70, 100, 'high')).toBe('normal');
  });

  it('keeps borderline inside the range, and the model word without numbers', () => {
    expect(deriveStatus(99, 70, 100, 'borderline')).toBe('borderline');
    expect(deriveStatus(null, null, null, 'abnormal')).toBe('abnormal');
    expect(deriveStatus(250, null, 200, 'normal')).toBe('high');
  });
});

describe('parseAnalysis', () => {
  const raw = {
    headline: 'Mostly fine, sugar is a little high',
    summary: 'Your blood count is normal. Fasting sugar is above range.',
    condition: 'fair',
    goodNews: ['Blood count is normal'],
    watchOut: ['Sugar is high'],
    areas: [{ area: 'Blood sugar', status: 'watch', note: 'Above range' }, { status: 'good' }],
    reports: [{ fileIndex: 0, title: 'Fasting blood sugar', reportDate: '2026-03-14' }],
    results: [
      {
        fileIndex: 0,
        testKey: 'Fasting Blood Glucose',
        testName: 'Fasting Blood Sugar',
        category: 'Blood sugar',
        value: '126',
        valueText: '126',
        unit: 'mg/dL',
        refLow: 70,
        refHigh: 100,
        status: 'normal',
        searchTerms: ['Sugar', 'diabetes', 'sugar'],
      },
      {
        fileIndex: 7,
        testName: 'Urine sugar',
        valueText: 'Negative',
        status: 'normal',
        category: 'Made up',
      },
      { testName: '', valueText: '1' },
    ],
  };

  it('normalises fields, rechecks status, and drops unusable rows', () => {
    const parsed = parseAnalysis(raw, 2)!;
    expect(parsed.results).toHaveLength(2);

    const [sugar, urine] = parsed.results;
    expect(sugar.testKey).toBe('fasting_blood_glucose');
    expect(sugar.value).toBe(126);
    expect(sugar.status).toBe('high');
    expect(sugar.searchTerms).toBe('sugar diabetes');

    expect(urine.value).toBeNull();
    expect(urine.fileIndex).toBe(1);
    expect(urine.category).toBe('Other');

    expect(parsed.overall.condition).toBe('fair');
    expect(parsed.overall.areas).toHaveLength(1);
    expect(parsed.reports[0].reportDate?.getDate()).toBe(14);
  });

  it('rejects a reply with nothing in it', () => {
    expect(parseAnalysis({}, 1)).toBeNull();
    expect(parseAnalysis('nope', 1)).toBeNull();
  });

  it('round-trips the overall verdict through storage, and survives garbage', () => {
    const parsed = parseAnalysis(raw, 1)!;
    expect(readOverall(JSON.stringify(parsed.overall)).watchOut).toEqual(['Sugar is high']);
    expect(readOverall('{bad').condition).toBe('unknown');
  });
});

describe('dates', () => {
  it('parses printed dates and rejects impossible or future ones', () => {
    expect(parseReportDate('2026-02-30')).toBeNull();
    expect(parseReportDate('2999-01-01')).toBeNull();
    expect(parseReportDate('14/03/2026')).toBeNull();
    expect(parseReportDate('2026-03-14')?.getMonth()).toBe(2);
  });

  it('files an analysis under its earliest printed date', () => {
    const fallback = new Date(2026, 10, 1);
    expect(reportDateFor([], fallback)).toBe(fallback);
    const date = reportDateFor(
      [
        { fileIndex: 0, title: 'a', reportDate: new Date(2026, 4, 2), labName: null },
        { fileIndex: 1, title: 'b', reportDate: new Date(2026, 4, 1), labName: null },
      ],
      fallback,
    );
    expect(date.getDate()).toBe(1);
  });
});

describe('rangePosition', () => {
  it('puts the normal band in the middle third', () => {
    expect(rangePosition(70, 70, 110)).toBeCloseTo(1 / 3);
    expect(rangePosition(110, 70, 110)).toBeCloseTo(2 / 3);
    expect(rangePosition(90, 70, 110)).toBeCloseTo(0.5);
  });

  it('clamps far-out values and handles one-sided ranges', () => {
    expect(rangePosition(1000, 70, 110)).toBe(1);
    expect(rangePosition(-50, 70, 110)).toBe(0);
    expect(rangePosition(250, null, 200)).toBeGreaterThan(2 / 3);
    expect(rangePosition(5, null, null)).toBeNull();
  });
});

describe('offline search', () => {
  const rows = [
    row({
      testKey: 'fasting_blood_glucose',
      testName: 'Fasting Blood Sugar',
      category: 'Blood sugar',
      value: 110,
      measuredAt: new Date(2025, 5, 1),
    }),
    row({
      testKey: 'fasting_blood_glucose',
      testName: 'FBS',
      category: 'Blood sugar',
      value: 126,
      measuredAt: new Date(2026, 2, 1),
    }),
    row({ testKey: 'hba1c', testName: 'HbA1c', category: 'Blood sugar', unit: '%', value: 6.1 }),
    row({
      testKey: 'ldl_cholesterol',
      testName: 'LDL Cholesterol',
      category: 'Cholesterol & fats',
    }),
    row({ testKey: 'hemoglobin', testName: 'Haemoglobin', category: 'Blood count', unit: 'g/dL' }),
    row({ testKey: 'serum_creatinine', testName: 'Serum Creatinine', category: 'Kidney' }),
    row({
      testKey: 'urine_sugar',
      testName: 'Urine Glucose',
      category: 'Urine',
      value: null,
      valueText: 'Nil',
    }),
  ];

  it('drops the filler words of a question', () => {
    expect(queryTerms('What is my sugar level?')).toEqual(['sugar']);
    expect(queryTerms('show my vitamin d')).toEqual(['vitamin d']);
  });

  it('answers "what is my sugar level" with the sugar tests, history intact', () => {
    const found = searchLabResults('what is my sugar level', rows);
    const keys = found.map((g) => g.testKey);
    expect(keys).toContain('fasting_blood_glucose');
    expect(keys).toContain('hba1c');
    expect(keys).not.toContain('ldl_cholesterol');

    const glucose = found.find((g) => g.testKey === 'fasting_blood_glucose')!;
    expect(glucose.history.map((r) => r.value)).toEqual([110, 126]);
    expect(glucose.latest.value).toBe(126);
  });

  it('finds by body area, abbreviation and prefix', () => {
    expect(searchLabResults('are my kidneys ok', rows).map((g) => g.testKey)).toEqual([
      'serum_creatinine',
    ]);
    expect(searchLabResults('hb', rows).map((g) => g.testKey)).toEqual(['hemoglobin']);
    expect(searchLabResults('choles', rows)[0].testKey).toBe('ldl_cholesterol');
  });

  it('does not let "hb" match HbA1c', () => {
    expect(searchLabResults('hb', rows).map((g) => g.testKey)).not.toContain('hba1c');
  });

  it('returns nothing for a question with no content words', () => {
    expect(searchLabResults('what is my level', rows)).toEqual([]);
    expect(searchLabResults('zebra', rows)).toEqual([]);
  });

  it('suggests questions only for tests that exist', () => {
    const questions = suggestedQuestions(groupByTest(rows));
    expect(questions).toContain('What is my sugar level?');
    expect(questions).not.toContain('How is my thyroid?');
  });

  it('normalises test keys', () => {
    expect(normaliseTestKey(' LDL-Cholesterol (Direct) ')).toBe('ldl_cholesterol_direct');
  });
});

describe('gemini', () => {
  it('converts the Gemini schema to JSON Schema, nullables included', () => {
    expect(toJsonSchema({ type: 'NUMBER', nullable: true })).toEqual({ type: ['number', 'null'] });
    expect(
      toJsonSchema({
        type: 'OBJECT',
        properties: { a: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['a'],
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'array', items: { type: 'string' } } },
      required: ['a'],
    });
    const results = (
      ANALYSIS_JSON_SCHEMA.properties as Record<
        string,
        { items: { properties: Record<string, { type: unknown }> } }
      >
    ).results;
    expect(results.items.properties.value.type).toEqual(['number', 'null']);
  });

  it('reads JSON out of the reply, fenced or not', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
    expect(parseJsonText('```json\n{"a":2}\n```')).toEqual({ ok: true, data: { a: 2 } });
    expect(parseJsonText('not json').ok).toBe(false);
    expect(parseJsonText('  ').ok).toBe(false);
  });

  it('finds the HTTP status in a Firebase error', () => {
    expect(statusFromError({ customErrorData: { status: 429 } })).toBe(429);
    expect(
      statusFromError(new Error('Error fetching from x: [503 Service Unavailable] busy')),
    ).toBe(503);
    expect(statusFromError(new Error('network down'))).toBe(0);
  });

  it('only falls through to another model when that could help', () => {
    expect(worthAnotherModel(404)).toBe(true);
    expect(worthAnotherModel(503)).toBe(true);
    expect(worthAnotherModel(400)).toBe(false);
    expect(worthAnotherModel(401)).toBe(false);
  });

  it('words errors for a person, not a developer', () => {
    expect(describeGeminiError(401, 'Firebase App Check token is invalid.')).toMatch(/verified/);
    expect(describeGeminiError(429, '')).toMatch(/limit/i);
    expect(describeGeminiError(503, '')).toMatch(/busy/);
    expect(describeGeminiError(0, '')).toMatch(/connection/);
  });

  it('counts only today toward the daily limit', () => {
    const now = new Date(2026, 10, 6, 15, 0);
    const dates = [
      new Date(2026, 10, 6, 9, 0),
      new Date(2026, 10, 6, 0, 1),
      new Date(2026, 10, 5, 23, 59),
    ];
    expect(analysesToday(dates, now)).toBe(2);
  });

  it('renews App Check tokens early, with a sane fallback', () => {
    expect(appCheckExpiry('3600s', 0)).toBe(55 * 60 * 1000);
    expect(appCheckExpiry('bad', 0)).toBe(25 * 60 * 1000);
    expect(appCheckExpiry('30s', 0)).toBe(60_000);
  });
});
