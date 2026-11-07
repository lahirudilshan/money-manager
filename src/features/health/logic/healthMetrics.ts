/**
 * One history per health measure, whatever recorded it.
 *
 * ## The problem
 *
 * A sugar figure reaches the app two ways: typed in from a home glucometer
 * (`health_readings`), or read off a lab report by AI (`health_lab_results`).
 * Stored apart, they were SHOWN apart — the home screen's "latest readings"
 * knew nothing about the lab's fasting glucose, and the lab view knew nothing
 * about the morning readings. "How is my sugar?" had two half-answers.
 *
 * ## The shape
 *
 * Both are mapped onto one row type (`MetricRow`, a superset of the search
 * module's `LabResultLike`) under a CANONICAL key, so the same measure from
 * both sources lands in one series. `groupByTest` then builds the series, and
 * `searchLabResults` searches them — the offline "what is my sugar level?"
 * finds home readings as well as lab results, with no second search path.
 *
 * Pure: no database, no React, so every rule here is tested.
 */

import {
  deriveStatus,
  groupByTest,
  isOutOfRange,
  type LabResultLike,
  type LabStatusKey,
  type TestGroup,
} from './labReports';

export type MetricSource = 'reading' | 'lab';

/** A row in a measure's history, from either source. */
export interface MetricRow extends LabResultLike {
  source: MetricSource;
  /** Diastolic, for blood pressure. */
  valueSecondary: number | null;
  /** Where to go to see or change it: the reading, or the analysis it came from. */
  refId: string;
  analysisId: string | null;
}

export type MetricSeries = TestGroup<MetricRow>;

/*
 * ---------------------------------------------------------------------------
 * Canonical keys
 * ---------------------------------------------------------------------------
 */

/**
 * Lab test keys that mean the same measure, folded onto one key.
 *
 * The AI is asked for a standard key, but labs name things freely and the
 * model does not always normalise ("fbs", "fasting_plasma_glucose"). A short
 * list for the common tests beats a second AI call to tidy names.
 */
const LAB_ALIASES: Record<string, string> = {
  fbs: 'fasting_blood_glucose',
  fasting_blood_sugar: 'fasting_blood_glucose',
  fasting_glucose: 'fasting_blood_glucose',
  fasting_plasma_glucose: 'fasting_blood_glucose',
  glucose_fasting: 'fasting_blood_glucose',
  ppbs: 'post_meal_blood_glucose',
  post_prandial_blood_sugar: 'post_meal_blood_glucose',
  postprandial_blood_glucose: 'post_meal_blood_glucose',
  rbs: 'random_blood_glucose',
  random_blood_sugar: 'random_blood_glucose',
  random_glucose: 'random_blood_glucose',
  glycated_hemoglobin: 'hba1c',
  glycated_haemoglobin: 'hba1c',
  hemoglobin_a1c: 'hba1c',
  haemoglobin_a1c: 'hba1c',
  a1c: 'hba1c',
  cholesterol: 'total_cholesterol',
  cholesterol_total: 'total_cholesterol',
  serum_cholesterol: 'total_cholesterol',
  ldl: 'ldl_cholesterol',
  ldl_c: 'ldl_cholesterol',
  hdl: 'hdl_cholesterol',
  hdl_c: 'hdl_cholesterol',
  triglyceride: 'triglycerides',
  serum_triglycerides: 'triglycerides',
  haemoglobin: 'hemoglobin',
  hb: 'hemoglobin',
  hgb: 'hemoglobin',
  creatinine: 'serum_creatinine',
  s_creatinine: 'serum_creatinine',
  thyroid_stimulating_hormone: 'tsh',
};

/** The key a lab test is filed under. */
export function canonicalKey(testKey: string): string {
  return LAB_ALIASES[testKey] ?? testKey;
}

/** The reading table's metric → the same canonical keys labs use. */
function readingKey(metric: string, context: string | null): string {
  if (metric === 'blood_sugar') {
    if (context === 'fasting') return 'fasting_blood_glucose';
    if (context === 'post_meal') return 'post_meal_blood_glucose';
    return 'random_blood_glucose';
  }
  if (metric === 'cholesterol') return 'total_cholesterol';
  if (metric === 'other') return 'other_reading';
  return metric;
}

/** Names for the canonical keys, used when a series has no lab name of its own. */
export const SERIES_LABEL: Record<string, string> = {
  blood_pressure: 'Blood pressure',
  fasting_blood_glucose: 'Fasting blood sugar',
  post_meal_blood_glucose: 'After-meal blood sugar',
  random_blood_glucose: 'Blood sugar',
  hba1c: 'HbA1c (3-month sugar)',
  total_cholesterol: 'Total cholesterol',
  ldl_cholesterol: 'LDL (“bad”) cholesterol',
  hdl_cholesterol: 'HDL (“good”) cholesterol',
  triglycerides: 'Triglycerides',
  weight: 'Weight',
  heart_rate: 'Heart rate',
  oxygen: 'Oxygen',
  temperature: 'Temperature',
  hemoglobin: 'Haemoglobin',
  serum_creatinine: 'Creatinine (kidneys)',
  tsh: 'TSH (thyroid)',
  other_reading: 'Other reading',
};

/** Which group each canonical key belongs to — the same groups the AI uses. */
const SERIES_CATEGORY: Record<string, string> = {
  blood_pressure: 'Heart',
  heart_rate: 'Heart',
  fasting_blood_glucose: 'Blood sugar',
  post_meal_blood_glucose: 'Blood sugar',
  random_blood_glucose: 'Blood sugar',
  hba1c: 'Blood sugar',
  total_cholesterol: 'Cholesterol & fats',
  ldl_cholesterol: 'Cholesterol & fats',
  hdl_cholesterol: 'Cholesterol & fats',
  triglycerides: 'Cholesterol & fats',
  weight: 'Body',
  oxygen: 'Body',
  temperature: 'Body',
  other_reading: 'Other',
};

/** Everyday words for readings, so search finds them like it finds lab rows. */
const SERIES_TERMS: Record<string, string> = {
  blood_pressure: 'pressure bp blood pressure hypertension',
  fasting_blood_glucose: 'sugar glucose diabetes fasting fbs',
  post_meal_blood_glucose: 'sugar glucose diabetes after meal ppbs',
  random_blood_glucose: 'sugar glucose diabetes rbs',
  hba1c: 'sugar diabetes hba1c a1c',
  total_cholesterol: 'cholesterol fat lipid',
  weight: 'weight kg body',
  heart_rate: 'pulse heart rate bpm',
  oxygen: 'oxygen spo2 saturation',
  temperature: 'temperature fever',
};

/*
 * ---------------------------------------------------------------------------
 * Typical ranges for home readings
 * ---------------------------------------------------------------------------
 */

/**
 * Typical adult ranges, so a home reading gets a verdict like a lab result.
 *
 * A lab prints its own range; a glucometer does not. These are the widely
 * published adult figures (ADA for sugar, AHA for pressure). `borderlineHigh`
 * is where a value stops being normal without yet being high — the "pre-"
 * band that matters most for sugar and pressure. The screens label these
 * "typical range" and carry the see-your-doctor note.
 */
interface TypicalRange {
  low: number | null;
  high: number;
  borderlineHigh?: number;
}

const TYPICAL: Record<string, TypicalRange> = {
  fasting_blood_glucose: { low: 70, high: 125, borderlineHigh: 99 },
  post_meal_blood_glucose: { low: 70, high: 199, borderlineHigh: 139 },
  random_blood_glucose: { low: 70, high: 199, borderlineHigh: 139 },
  hba1c: { low: null, high: 6.4, borderlineHigh: 5.6 },
  total_cholesterol: { low: null, high: 239, borderlineHigh: 199 },
  heart_rate: { low: 60, high: 100 },
  oxygen: { low: 95, high: 100 },
  temperature: { low: 36.1, high: 37.5 },
};

/** The normal band to draw and compare against, for a canonical key. */
export function typicalBand(key: string): { low: number | null; high: number } | null {
  if (key === 'blood_pressure') return { low: 90, high: 119 };
  const range = TYPICAL[key];
  if (!range) return null;
  return { low: range.low, high: range.borderlineHigh ?? range.high };
}

/** The verdict on a home reading, from the typical range for its measure. */
export function readingStatus(
  key: string,
  value: number,
  valueSecondary: number | null,
): LabStatusKey {
  if (key === 'blood_pressure') {
    // AHA bands, matching measureGuide.ts: elevated 120–129 / under 80,
    // high from 130 or from 80 (stage 1), low under 90 / 60.
    const diastolic = valueSecondary ?? 0;
    if (value < 90 || (valueSecondary !== null && diastolic < 60)) return 'low';
    if (value >= 130 || diastolic >= 80) return 'high';
    if (value >= 120) return 'borderline';
    return 'normal';
  }
  const range = TYPICAL[key];
  if (!range) return 'unknown';
  if (range.low !== null && value < range.low) return 'low';
  if (value > range.high) return 'high';
  if (range.borderlineHigh !== undefined && value > range.borderlineHigh) return 'borderline';
  return 'normal';
}

/**
 * What a flagged value should be, as one short sentence.
 *
 * "128/50 · Normal 90–119 · Low" reads as a contradiction: it is the 50 that
 * is low, not the 128. So blood pressure names the number that is off and
 * gives only ITS range; every other measure gives its normal range.
 */
export function shouldBe(row: {
  testKey: string;
  value: number | null;
  valueSecondary: number | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
}): string | null {
  if (row.testKey === 'blood_pressure' && row.value !== null) {
    const top = row.value;
    const bottom = row.valueSecondary;
    if (top < 90) return 'The top number should be 90–119';
    if (bottom !== null && bottom < 60) return 'The bottom number should be 60–79';
    if (top >= 120) return 'The top number should be under 120';
    if (bottom !== null && bottom >= 80) return 'The bottom number should be under 80';
    return null;
  }
  const u = row.unit ? ` ${row.unit}` : '';
  const { refLow: low, refHigh: high } = row;
  if (low !== null && high !== null) return `Should be ${trimNumber(low)}–${trimNumber(high)}${u}`;
  if (high !== null) return `Should be under ${trimNumber(high)}${u}`;
  if (low !== null) return `Should be above ${trimNumber(low)}${u}`;
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Building rows
 * ---------------------------------------------------------------------------
 */

export interface ReadingInput {
  id: string;
  metric: string;
  value: number;
  valueSecondary: number | null;
  unit: string | null;
  context: string | null;
  measuredAt: Date;
}

export interface LabInput {
  id: string;
  analysisId: string;
  testKey: string;
  testName: string;
  category: string;
  value: number | null;
  valueText: string;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  status: LabStatusKey;
  searchTerms: string;
  bodyArea: string | null;
  measuredAt: Date;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

export function readingRow(reading: ReadingInput): MetricRow {
  const key = readingKey(reading.metric, reading.context);
  const band = typicalBand(key);
  return {
    id: `reading:${reading.id}`,
    refId: reading.id,
    analysisId: null,
    source: 'reading',
    testKey: key,
    testName: SERIES_LABEL[key] ?? key,
    category: SERIES_CATEGORY[key] ?? 'Other',
    value: reading.value,
    valueSecondary: reading.valueSecondary,
    valueText:
      reading.valueSecondary !== null
        ? `${trimNumber(reading.value)}/${trimNumber(reading.valueSecondary)}`
        : trimNumber(reading.value),
    unit: reading.unit,
    refLow: band?.low ?? null,
    refHigh: band?.high ?? null,
    status: readingStatus(key, reading.value, reading.valueSecondary),
    searchTerms: SERIES_TERMS[key] ?? '',
    bodyArea: null,
    measuredAt: reading.measuredAt,
  };
}

export function labRow(lab: LabInput): MetricRow {
  return {
    id: `lab:${lab.id}`,
    refId: lab.id,
    analysisId: lab.analysisId,
    source: 'lab',
    testKey: canonicalKey(lab.testKey),
    testName: lab.testName,
    category: lab.category,
    value: lab.value,
    valueSecondary: null,
    valueText: lab.valueText,
    unit: lab.unit,
    refLow: lab.refLow,
    refHigh: lab.refHigh,
    // Rechecked against the printed range, as everywhere else.
    status: deriveStatus(lab.value, lab.refLow, lab.refHigh, lab.status),
    searchTerms: lab.searchTerms,
    bodyArea: lab.bodyArea,
    measuredAt: lab.measuredAt,
  };
}

/** Every measure for one person, as series, newest activity first. */
export function buildSeries(
  readings: readonly ReadingInput[],
  labs: readonly LabInput[],
): MetricSeries[] {
  const rows = [...readings.map(readingRow), ...labs.map(labRow)];
  return groupByTest(rows)
    .map((group) => ({
      ...group,
      // A series fed only by home readings has a plain name; once a lab
      // has named it, the lab's wording (what the paper says) is kept.
      testName: group.history.some((r) => r.source === 'lab')
        ? ([...group.history].reverse().find((r) => r.source === 'lab')?.testName ??
          group.testName)
        : (SERIES_LABEL[group.testKey] ?? group.testName),
    }))
    .sort((a, b) => b.latest.measuredAt.getTime() - a.latest.measuredAt.getTime());
}

/*
 * ---------------------------------------------------------------------------
 * What the home screen shows
 * ---------------------------------------------------------------------------
 */

/** The measures people track most, in the order they are looked for. */
const PRIORITY = [
  'blood_pressure',
  'fasting_blood_glucose',
  'hba1c',
  'random_blood_glucose',
  'post_meal_blood_glucose',
  'total_cholesterol',
  'ldl_cholesterol',
  'weight',
  'hemoglobin',
  'serum_creatinine',
  'tsh',
];

/**
 * The few measures worth a tile on the home screen.
 *
 * Out of range FIRST: the point of the screen is noticing what needs
 * attention, and a high LDL buried below a normal heart rate defeats it. Then
 * the measures people track most, then whatever was measured most recently.
 */
export function homeSeries(series: readonly MetricSeries[], limit = 6): MetricSeries[] {
  const rank = (s: MetricSeries) => {
    const index = PRIORITY.indexOf(s.testKey);
    return index === -1 ? PRIORITY.length : index;
  };
  return [...series]
    .sort((a, b) => {
      const flagged = Number(isOutOfRange(b.latest.status)) - Number(isOutOfRange(a.latest.status));
      if (flagged !== 0) return flagged;
      const priority = rank(a) - rank(b);
      if (priority !== 0) return priority;
      return b.latest.measuredAt.getTime() - a.latest.measuredAt.getTime();
    })
    .slice(0, limit);
}

/** The measures whose latest value is out of range — "needs a look". */
export function flaggedSeries(series: readonly MetricSeries[]): MetricSeries[] {
  return series.filter((s) => isOutOfRange(s.latest.status));
}

/** How the latest numeric value moved from the one before, or null. */
export function changeSincePrevious(
  series: MetricSeries,
): { delta: number; since: Date } | null {
  const numeric = series.history.filter((r) => r.value !== null);
  if (numeric.length < 2) return null;
  const latest = numeric[numeric.length - 1];
  const previous = numeric[numeric.length - 2];
  return { delta: (latest.value as number) - (previous.value as number), since: previous.measuredAt };
}
