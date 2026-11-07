import { describe, expect, it } from 'vitest';
import {
  buildSeries,
  canonicalKey,
  changeSincePrevious,
  flaggedSeries,
  homeSeries,
  readingStatus,
  type LabInput,
  type ReadingInput,
} from '~/features/health/logic/healthMetrics';
import { searchLabResults } from '~/features/health/logic/labReports';

const reading = (p: Partial<ReadingInput> & Pick<ReadingInput, 'metric' | 'value'>): ReadingInput => ({
  id: `r-${p.metric}-${p.value}`,
  valueSecondary: null,
  unit: null,
  context: null,
  measuredAt: new Date(2026, 0, 1),
  ...p,
});

const lab = (p: Partial<LabInput> & Pick<LabInput, 'testKey' | 'testName'>): LabInput => ({
  id: `l-${p.testKey}`,
  analysisId: 'a1',
  category: 'Other',
  value: 100,
  valueText: String(p.value ?? 100),
  unit: 'mg/dL',
  refLow: null,
  refHigh: null,
  status: 'unknown',
  searchTerms: '',
  bodyArea: null,
  measuredAt: new Date(2026, 2, 1),
  ...p,
});

describe('one history per measure', () => {
  it('merges a home fasting sugar with the lab fasting glucose', () => {
    const series = buildSeries(
      [reading({ metric: 'blood_sugar', context: 'fasting', value: 110, measuredAt: new Date(2026, 0, 5) })],
      [lab({ testKey: 'fbs', testName: 'Fasting Blood Sugar', value: 126, refLow: 70, refHigh: 100 })],
    );
    expect(series).toHaveLength(1);
    expect(series[0].testKey).toBe('fasting_blood_glucose');
    expect(series[0].history.map((r) => r.source)).toEqual(['reading', 'lab']);
    // The lab's wording names a series once a lab has seen it.
    expect(series[0].testName).toBe('Fasting Blood Sugar');
    expect(series[0].latest.status).toBe('high');
  });

  it('keeps fasting and after-meal sugar apart — they mean different things', () => {
    const series = buildSeries(
      [
        reading({ metric: 'blood_sugar', context: 'fasting', value: 95 }),
        reading({ metric: 'blood_sugar', context: 'post_meal', value: 150 }),
      ],
      [],
    );
    expect(series.map((s) => s.testKey).sort()).toEqual([
      'fasting_blood_glucose',
      'post_meal_blood_glucose',
    ]);
  });

  it('folds lab name variants onto one key', () => {
    expect(canonicalKey('ldl_c')).toBe('ldl_cholesterol');
    expect(canonicalKey('haemoglobin')).toBe('hemoglobin');
    expect(canonicalKey('something_new')).toBe('something_new');
  });

  it('lets offline search find home readings too', () => {
    const series = buildSeries([reading({ metric: 'blood_pressure', value: 145, valueSecondary: 92 })], []);
    const found = searchLabResults('what is my blood pressure', series.flatMap((s) => s.history));
    expect(found[0]?.testKey).toBe('blood_pressure');
    expect(found[0]?.latest.valueText).toBe('145/92');
  });
});

describe('verdicts on home readings', () => {
  it('reads blood pressure by either number', () => {
    expect(readingStatus('blood_pressure', 118, 76)).toBe('normal');
    expect(readingStatus('blood_pressure', 124, 78)).toBe('borderline');
    expect(readingStatus('blood_pressure', 132, 78)).toBe('high');
    expect(readingStatus('blood_pressure', 118, 84)).toBe('high');
    expect(readingStatus('blood_pressure', 85, 55)).toBe('low');
  });

  it('uses the pre-diabetes band for sugar', () => {
    expect(readingStatus('fasting_blood_glucose', 92, null)).toBe('normal');
    expect(readingStatus('fasting_blood_glucose', 110, null)).toBe('borderline');
    expect(readingStatus('fasting_blood_glucose', 130, null)).toBe('high');
    expect(readingStatus('fasting_blood_glucose', 60, null)).toBe('low');
    expect(readingStatus('hba1c', 6.0, null)).toBe('borderline');
  });

  it('gives no verdict where there is no typical range', () => {
    expect(readingStatus('weight', 80, null)).toBe('unknown');
  });
});

describe('the home screen', () => {
  const series = buildSeries(
    [
      reading({ metric: 'weight', value: 70, measuredAt: new Date(2026, 3, 1) }),
      reading({ metric: 'blood_pressure', value: 118, valueSecondary: 76 }),
      reading({ metric: 'heart_rate', value: 72 }),
    ],
    [lab({ testKey: 'ldl_cholesterol', testName: 'LDL', value: 170, refHigh: 130 })],
  );

  it('puts out-of-range measures first, then the usual ones', () => {
    expect(homeSeries(series).map((s) => s.testKey)).toEqual([
      'ldl_cholesterol',
      'blood_pressure',
      'weight',
      'heart_rate',
    ]);
    expect(homeSeries(series, 2)).toHaveLength(2);
  });

  it('flags only what is out of range', () => {
    expect(flaggedSeries(series).map((s) => s.testKey)).toEqual(['ldl_cholesterol']);
  });

  it('reports the change since the previous value', () => {
    const [weight] = buildSeries(
      [
        reading({ id: 'w1', metric: 'weight', value: 72, measuredAt: new Date(2026, 0, 1) }),
        reading({ id: 'w2', metric: 'weight', value: 70.5, measuredAt: new Date(2026, 1, 1) }),
      ],
      [],
    );
    expect(changeSincePrevious(weight)?.delta).toBeCloseTo(-1.5);
    expect(changeSincePrevious(series.find((s) => s.testKey === 'heart_rate')!)).toBeNull();
  });
});
