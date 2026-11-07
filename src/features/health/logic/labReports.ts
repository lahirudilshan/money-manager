/**
 * Lab reports, read once by AI and then answered from the database forever.
 *
 * ## The shape of the feature
 *
 * A lab report is a table of numbers with a reference range beside each one,
 * written for a doctor. The person holding it wants three things: "is anything
 * wrong?", "what does this number even mean?", and — months later — "what was
 * my sugar last time?".
 *
 * The first two need something that can read a photographed page and explain
 * it, which is what the AI step does. The third must NOT need it: the answer
 * is already in the report, so the AI's job ends at turning the paper into
 * rows. After that every question is a local query (see `searchLabResults`),
 * which works offline, costs nothing, and cannot hallucinate a value the
 * report never had.
 *
 * Everything here is pure — no network, no database — so it is unit tested.
 */

/*
 * ---------------------------------------------------------------------------
 * What the AI returns
 * ---------------------------------------------------------------------------
 */

export type LabStatusKey = 'low' | 'normal' | 'high' | 'borderline' | 'abnormal' | 'unknown';
export const LAB_STATUSES: readonly LabStatusKey[] = [
  'low',
  'normal',
  'high',
  'borderline',
  'abnormal',
  'unknown',
];

export type ConditionKey = 'good' | 'fair' | 'needs_attention' | 'unknown';
export type AreaStatus = 'good' | 'watch' | 'concern';

/** One body area's verdict — "Kidneys: working well". */
export interface AreaVerdict {
  area: string;
  status: AreaStatus;
  note: string;
}

/** The plain-English verdict over a whole batch, stored as JSON. */
export interface AnalysisOverall {
  condition: ConditionKey;
  goodNews: string[];
  watchOut: string[];
  areas: AreaVerdict[];
  questionsForDoctor: string[];
  /** Everyday things that usually help, phrased as suggestions. */
  tips: string[];
}

export interface ParsedReport {
  /** Index into the files sent, so the result can be tied to its document. */
  fileIndex: number;
  title: string;
  reportDate: Date | null;
  labName: string | null;
}

export interface ParsedResult {
  fileIndex: number;
  testKey: string;
  testName: string;
  category: string;
  value: number | null;
  valueText: string;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  status: LabStatusKey;
  meaning: string | null;
  ifHigh: string | null;
  ifLow: string | null;
  bodyArea: string | null;
  explanation: string | null;
  searchTerms: string;
}

export interface ParsedAnalysis {
  headline: string;
  summary: string;
  overall: AnalysisOverall;
  reports: ParsedReport[];
  results: ParsedResult[];
}

/**
 * The JSON schema the model is held to.
 *
 * Gemini's `responseSchema` is an OpenAPI subset: upper-case type names and
 * `nullable` rather than union types. Holding the model to a schema is what
 * makes `parseAnalysis` a validation step instead of a guessing one.
 */
export const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    condition: { type: 'STRING', enum: ['good', 'fair', 'needs_attention', 'unknown'] },
    goodNews: { type: 'ARRAY', items: { type: 'STRING' } },
    watchOut: { type: 'ARRAY', items: { type: 'STRING' } },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
    questionsForDoctor: { type: 'ARRAY', items: { type: 'STRING' } },
    areas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          area: { type: 'STRING' },
          status: { type: 'STRING', enum: ['good', 'watch', 'concern'] },
          note: { type: 'STRING' },
        },
        required: ['area', 'status', 'note'],
      },
    },
    reports: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          fileIndex: { type: 'INTEGER' },
          title: { type: 'STRING' },
          reportDate: { type: 'STRING', nullable: true },
          labName: { type: 'STRING', nullable: true },
        },
        required: ['fileIndex', 'title'],
      },
    },
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          fileIndex: { type: 'INTEGER' },
          testKey: { type: 'STRING' },
          testName: { type: 'STRING' },
          category: { type: 'STRING' },
          value: { type: 'NUMBER', nullable: true },
          valueText: { type: 'STRING' },
          unit: { type: 'STRING', nullable: true },
          refLow: { type: 'NUMBER', nullable: true },
          refHigh: { type: 'NUMBER', nullable: true },
          refText: { type: 'STRING', nullable: true },
          status: { type: 'STRING', enum: [...LAB_STATUSES] },
          meaning: { type: 'STRING' },
          ifHigh: { type: 'STRING' },
          ifLow: { type: 'STRING' },
          bodyArea: { type: 'STRING' },
          explanation: { type: 'STRING' },
          searchTerms: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['fileIndex', 'testKey', 'testName', 'valueText', 'status'],
      },
    },
  },
  required: ['headline', 'summary', 'condition', 'results', 'reports', 'areas'],
} as const;

/** The categories the list groups by. The model is asked to pick from these. */
export const LAB_CATEGORIES = [
  'Blood sugar',
  'Cholesterol & fats',
  'Kidney',
  'Liver',
  'Blood count',
  'Thyroid',
  'Vitamins & minerals',
  'Heart',
  'Urine',
  'Infection & inflammation',
  'Hormones',
  'Other',
] as const;

/*
 * ---------------------------------------------------------------------------
 * Validating what came back
 * ---------------------------------------------------------------------------
 */

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter((s): s is string => s !== null);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** YYYY-MM-DD → a local-midnight Date, or null. Rejects impossible dates. */
export function parseReportDate(value: unknown): Date | null {
  const text = str(value);
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  // A report "from the future" is a misread year; null lets the caller fall
  // back to today rather than plot a point next year.
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return date;
}

/** A stable key for "the same test", whatever the lab called it. */
export function normaliseTestKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * The status, checked against the numbers when there are numbers.
 *
 * The range is printed on the page and the comparison is arithmetic, so it is
 * done here rather than trusted: a model that misreads "high" as "normal" on a
 * value plainly above the range would otherwise tell someone they are fine.
 * The model's word is kept when there is nothing to compare (a "Negative"
 * result), and "borderline" is kept when the value is in range, because labs
 * print borderline bands the two numbers cannot express.
 */
export function deriveStatus(
  value: number | null,
  refLow: number | null,
  refHigh: number | null,
  claimed: LabStatusKey,
): LabStatusKey {
  if (value === null || (refLow === null && refHigh === null)) return claimed;
  if (refLow !== null && value < refLow) return 'low';
  if (refHigh !== null && value > refHigh) return 'high';
  return claimed === 'borderline' ? 'borderline' : 'normal';
}

/**
 * Turn the model's JSON into rows, or null when it is not usable at all.
 *
 * Total and forgiving per field — one malformed result is dropped, not the
 * whole analysis — but strict on the whole: no results and no summary means
 * the call failed, whatever the model said.
 */
export function parseAnalysis(raw: unknown, fileCount: number): ParsedAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const results = parseResults(data.results, fileCount);
  const overall = parseOverall(data);
  if (results.length === 0 && !overall.summary) return null;
  return { ...overall, reports: parseReports(data.reports, fileCount), results };
}

function clampIndex(value: unknown, fileCount: number): number {
  const index = Math.trunc(num(value) ?? 0);
  return Math.min(Math.max(0, index), Math.max(0, fileCount - 1));
}

function parseResults(items: unknown, fileCount: number): ParsedResult[] {
  const results: ParsedResult[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const testName = str(r.testName);
    const value = num(r.value);
    const valueText = str(r.valueText) ?? (value !== null ? String(value) : null);
    if (!testName || !valueText) continue;

    const refLow = num(r.refLow);
    const refHigh = num(r.refHigh);
    const testKey = normaliseTestKey(str(r.testKey) ?? testName) || normaliseTestKey(testName);

    results.push({
      fileIndex: clampIndex(r.fileIndex, fileCount),
      testKey,
      testName,
      category: oneOf(str(r.category), LAB_CATEGORIES, 'Other'),
      value,
      valueText,
      unit: str(r.unit),
      refLow,
      refHigh,
      refText: str(r.refText),
      status: deriveStatus(value, refLow, refHigh, oneOf(r.status, LAB_STATUSES, 'unknown')),
      meaning: str(r.meaning),
      ifHigh: str(r.ifHigh),
      ifLow: str(r.ifLow),
      bodyArea: str(r.bodyArea),
      explanation: str(r.explanation),
      searchTerms: searchTermsText(r.searchTerms),
    });
  }
  return results;
}

function searchTermsText(value: unknown): string {
  return [...new Set(strings(value).map((t) => t.toLowerCase()))].join(' ');
}

function parseReports(items: unknown, fileCount: number): ParsedReport[] {
  const reports: ParsedReport[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    reports.push({
      fileIndex: clampIndex(r.fileIndex, fileCount),
      title: str(r.title) ?? 'Lab report',
      reportDate: parseReportDate(r.reportDate),
      labName: str(r.labName),
    });
  }
  return reports;
}

function parseOverall(data: Record<string, unknown>): {
  headline: string;
  summary: string;
  overall: AnalysisOverall;
} {
  const areas: AreaVerdict[] = [];
  for (const item of Array.isArray(data.areas) ? data.areas : []) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const area = str(a.area);
    if (!area) continue;
    areas.push({
      area,
      status: oneOf(a.status, ['good', 'watch', 'concern'] as const, 'watch'),
      note: str(a.note) ?? '',
    });
  }
  return {
    headline: str(data.headline) ?? 'Your reports have been read',
    summary: str(data.summary) ?? '',
    overall: {
      condition: oneOf(
        data.condition,
        ['good', 'fair', 'needs_attention', 'unknown'] as const,
        'unknown',
      ),
      goodNews: strings(data.goodNews),
      watchOut: strings(data.watchOut),
      areas,
      questionsForDoctor: strings(data.questionsForDoctor),
      tips: strings(data.tips),
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * Two calls: read the numbers, then explain them
 * ---------------------------------------------------------------------------
 *
 * One call that both read the pages and wrote a paragraph of plain English
 * for every test ran past Gemini's deadline on long reports
 * (DEADLINE_EXCEEDED): the pages were never the slow part — thousands of
 * tokens of explanation, written while the pages were still attached, were.
 *
 * So the work is split:
 *
 * 1. EXTRACT — the pages go in, only the numbers come out. Short answer.
 * 2. EXPLAIN — no pages; a few lines of text per result go in, the words
 *    come out. What a test MEANS (meaning / ifHigh / ifLow / bodyArea /
 *    searchTerms) is the same for every person and every report, so it is
 *    asked for only for tests this phone has never explained before — the
 *    rest are reused from earlier results (`healthLabRepo.testWords`).
 *
 * If step 2 fails, the numbers from step 1 are still saved: they are the
 * part that cannot be recreated without sending the pages again.
 */

/** Step 1's schema: reports and raw results, no prose. */
export const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reports: ANALYSIS_RESPONSE_SCHEMA.properties.reports,
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          fileIndex: { type: 'INTEGER' },
          testKey: { type: 'STRING' },
          testName: { type: 'STRING' },
          category: { type: 'STRING' },
          value: { type: 'NUMBER', nullable: true },
          valueText: { type: 'STRING' },
          unit: { type: 'STRING', nullable: true },
          refLow: { type: 'NUMBER', nullable: true },
          refHigh: { type: 'NUMBER', nullable: true },
          refText: { type: 'STRING', nullable: true },
          status: { type: 'STRING', enum: [...LAB_STATUSES] },
        },
        required: ['fileIndex', 'testKey', 'testName', 'valueText', 'status'],
      },
    },
  },
  required: ['reports', 'results'],
} as const;

/** Step 2's schema: the verdict, one sentence per result, and new test words. */
export const EXPLANATION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    condition: { type: 'STRING', enum: ['good', 'fair', 'needs_attention', 'unknown'] },
    goodNews: { type: 'ARRAY', items: { type: 'STRING' } },
    watchOut: { type: 'ARRAY', items: { type: 'STRING' } },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
    questionsForDoctor: { type: 'ARRAY', items: { type: 'STRING' } },
    areas: ANALYSIS_RESPONSE_SCHEMA.properties.areas,
    explanations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { index: { type: 'INTEGER' }, explanation: { type: 'STRING' } },
        required: ['index', 'explanation'],
      },
    },
    tests: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          testKey: { type: 'STRING' },
          meaning: { type: 'STRING' },
          ifHigh: { type: 'STRING' },
          ifLow: { type: 'STRING' },
          bodyArea: { type: 'STRING' },
          searchTerms: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['testKey', 'meaning', 'bodyArea'],
      },
    },
  },
  required: ['headline', 'summary', 'condition', 'areas', 'explanations'],
} as const;

const NUMBER_RULES = [
  'Rules for the numbers:',
  '- Copy values, units and reference ranges exactly as printed. Never invent a value.',
  '- value: the number only (no units). Use null when the result is words like "Negative".',
  '- valueText: the result as printed, e.g. "126" or "Negative".',
  '- refLow/refHigh: the printed reference range as numbers. For "< 200" set refLow null and refHigh 200.',
  '- refText: the range exactly as printed. When the range depends on sex or age, copy all of it.',
  '- status: compare the value to the printed range. "borderline" only when the report itself says so.',
  '- testKey: lowercase snake_case standard name, the same across labs, e.g. fasting_blood_glucose, hba1c, total_cholesterol, ldl_cholesterol, hdl_cholesterol, triglycerides, serum_creatinine, hemoglobin, platelet_count, tsh, vitamin_d.',
  `- category: one of ${LAB_CATEGORIES.map((c) => `"${c}"`).join(', ')}.`,
  '- reportDate: the sample or report date printed on the page as YYYY-MM-DD, or null.',
];

/*
 * Written for the READER the output is for: someone with no medical training,
 * possibly reading English as a second language. Hence the reading-level rule,
 * the ban on jargon without an explanation, and "may" rather than "you have".
 */
const WORD_RULES = [
  'Rules for the words (this is the important part):',
  '- Write for someone with no medical training, at the level of a 12-year-old. Short sentences.',
  '- If you must use a medical word, explain it in brackets.',
  '- Use "may" and "can"; never state a diagnosis as fact. Do not add a disclaimer — the app shows one.',
];

/**
 * How each saved document gets its name. The title is what the user sees in
 * their report list for years, so it names the TEST, in everyday words —
 * the printed header is usually the lab's letterhead or "LABORATORY REPORT".
 */
const TITLE_RULES = [
  'Rules for the reports list:',
  '- One entry per FILE (fileIndex 0, 1, 2…), even when one report spans several files.',
  '- title: a short everyday name for what that file tests, 2–4 words, sentence case, e.g. "Full blood count", "Lipid profile", "Fasting blood sugar", "Thyroid test", "Liver function test", "Urine test". When one page has several panels, name the main one or use a plain group like "Blood sugar & cholesterol".',
  '- title must NEVER be the lab or hospital name, the patient name, a reference number, or a generic word like "Lab report", "Laboratory report" or "Test report".',
  '- labName: the lab or hospital name printed on the page, or null.',
];

/** Step 1, sent as the system instruction: the same for every call. */
export const EXTRACTION_INSTRUCTION = [
  'You read medical lab reports and copy every test result into JSON matching the schema.',
  'Files are numbered from 0 in the order given. Pages of one report may span several files.',
  'Read EVERY test result on every page. Skip files that are not lab reports.',
  'Write no explanations — numbers and names only.',
  '- reports[].title: the everyday name of the test in 2–4 words, as a patient would say it, e.g. "Full blood count", "Lipid profile", "Fasting blood sugar", "Kidney function test", "Thyroid test". When one file holds two tests, join the main two, e.g. "Lipid profile & sugar". Never the lab name, the patient name, or a generic "Laboratory report".',
  '- reports[].labName: the lab or hospital name from the letterhead, or null.',
  '',
  ...TITLE_RULES,
  '',
  ...NUMBER_RULES,
].join('\n');

/** Step 1's per-call message — only what changes between calls. */
export function buildExtractionPrompt(fileCount: number): string {
  return `There are ${fileCount} file(s). Return every test result.`;
}

/** Step 2, sent as the system instruction. */
export const EXPLANATION_INSTRUCTION = [
  'You help a person understand their own medical lab results, which have already been read off the page.',
  'Return JSON matching the schema.',
  '',
  ...WORD_RULES,
  '- explanations: one entry per numbered result: what THIS result means for this person, one or two sentences.',
  '- tests: one entry for each test listed under "Explain these tests", none for others:',
  '  meaning: what the test measures, one sentence.',
  '  ifHigh / ifLow: what it usually means when high / low, and what part of the body it affects. One or two sentences each.',
  '  bodyArea: the organ or system, e.g. "Kidneys", "Liver", "Heart and blood vessels", "Blood".',
  '  searchTerms: 3–8 everyday words someone might search with, e.g. for glucose: "sugar", "blood sugar", "diabetes", "glucose".',
  '- headline: one short sentence on how things look overall.',
  '- summary: 2–4 sentences on the current health picture across all results.',
  '- condition: good (all or almost all normal), fair (a few mild issues), needs_attention (clear problems).',
  '- areas: one entry per body area tested, with good / watch / concern and a short note.',
  '- goodNews, watchOut: short bullet sentences. tips: simple everyday suggestions, never medicine doses.',
  '- questionsForDoctor: 2–5 questions worth asking at the next visit.',
].join('\n');

/** One result as a line of text for step 2 — "3. HbA1c: 6.1 % (range < 5.7) high". */
function resultLine(r: ParsedResult, index: number): string {
  const range =
    r.refText ??
    (r.refLow !== null || r.refHigh !== null
      ? `${r.refLow ?? ''}–${r.refHigh ?? ''}`.replace(/^–/, '< ').replace(/–$/, '+')
      : null);
  return `${index}. ${r.testName} [${r.testKey}]: ${r.valueText}${r.unit ? ` ${r.unit}` : ''}${range ? ` (range ${range})` : ''} — ${r.status}`;
}

export function buildExplanationPrompt(input: {
  person: { name: string; age?: number | null; sex?: string | null; conditions?: string | null };
  results: readonly ParsedResult[];
  /** testKeys with no stored meaning yet. */
  unexplained: readonly string[];
}): string {
  const { person } = input;
  const who = [person.age ? `${person.age} years old` : null, person.sex ?? null]
    .filter(Boolean)
    .join(', ');
  return [
    `Person: ${person.name}${who ? ` (${who})` : ''}.`,
    ...(person.conditions ? [`Known conditions: ${person.conditions}.`] : []),
    '',
    'Results:',
    ...input.results.map(resultLine),
    '',
    input.unexplained.length > 0
      ? `Explain these tests: ${input.unexplained.join(', ')}`
      : 'Explain these tests: none (return an empty tests list).',
  ].join('\n');
}

/** What a test means — the same for everyone, so stored once and reused. */
export interface TestWords {
  meaning: string | null;
  ifHigh: string | null;
  ifLow: string | null;
  bodyArea: string | null;
  searchTerms: string;
}

/** Step 1's reply → reports and bare results, or null when nothing was read. */
export function parseExtraction(
  raw: unknown,
  fileCount: number,
): { reports: ParsedReport[]; results: ParsedResult[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const results = parseResults(data.results, fileCount);
  if (results.length === 0) return null;
  return { reports: parseReports(data.reports, fileCount), results };
}

/**
 * Extractions of file groups, read in parallel, as one. Inside its own call a
 * group numbers its files from 0; `firstFile` shifts that to the file's
 * position in the whole batch. Null extractions are groups that failed; null
 * overall when nothing was read.
 */
export function combineExtractions(
  parts: readonly {
    firstFile: number;
    extraction: { reports: ParsedReport[]; results: ParsedResult[] } | null;
  }[],
): { reports: ParsedReport[]; results: ParsedResult[] } | null {
  const reports: ParsedReport[] = [];
  const results: ParsedResult[] = [];
  for (const { firstFile, extraction } of parts) {
    if (!extraction) continue;
    reports.push(...extraction.reports.map((r) => ({ ...r, fileIndex: firstFile + r.fileIndex })));
    results.push(...extraction.results.map((r) => ({ ...r, fileIndex: firstFile + r.fileIndex })));
  }
  return results.length > 0 ? { reports, results } : null;
}

/** testKeys among these results that have no stored words. */
export function unexplainedKeys(
  results: readonly ParsedResult[],
  known: ReadonlyMap<string, TestWords>,
): string[] {
  return [...new Set(results.map((r) => r.testKey))].filter((key) => !known.get(key)?.meaning);
}

/**
 * Step 1's results with step 2's words laid over them.
 *
 * `rawExplanation` may be null — step 2 failed — and the results are still
 * complete as numbers, with whatever words were stored from earlier reports.
 */
export function mergeExplanation(
  extraction: { reports: ParsedReport[]; results: ParsedResult[] },
  rawExplanation: unknown,
  known: ReadonlyMap<string, TestWords>,
): ParsedAnalysis {
  const data =
    rawExplanation && typeof rawExplanation === 'object'
      ? (rawExplanation as Record<string, unknown>)
      : {};

  const words = new Map(known);
  for (const item of Array.isArray(data.tests) ? data.tests : []) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const key = normaliseTestKey(str(t.testKey) ?? '');
    if (!key || !str(t.meaning)) continue;
    words.set(key, {
      meaning: str(t.meaning),
      ifHigh: str(t.ifHigh),
      ifLow: str(t.ifLow),
      bodyArea: str(t.bodyArea),
      searchTerms: searchTermsText(t.searchTerms),
    });
  }

  const explanations = new Map<number, string>();
  for (const item of Array.isArray(data.explanations) ? data.explanations : []) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const index = num(e.index);
    const text = str(e.explanation);
    if (index !== null && text) explanations.set(Math.trunc(index), text);
  }

  const results = extraction.results.map((r, index): ParsedResult => {
    const w = words.get(r.testKey);
    return {
      ...r,
      meaning: r.meaning ?? w?.meaning ?? null,
      ifHigh: r.ifHigh ?? w?.ifHigh ?? null,
      ifLow: r.ifLow ?? w?.ifLow ?? null,
      bodyArea: r.bodyArea ?? w?.bodyArea ?? null,
      searchTerms: r.searchTerms || w?.searchTerms || '',
      explanation: r.explanation ?? explanations.get(index) ?? null,
    };
  });

  return { ...parseOverall(data), reports: extraction.reports, results };
}

/** Read the stored JSON back. Total: a bad value renders as "nothing to show". */
export function readOverall(json: string | null | undefined): AnalysisOverall {
  const empty: AnalysisOverall = {
    condition: 'unknown',
    goodNews: [],
    watchOut: [],
    areas: [],
    questionsForDoctor: [],
    tips: [],
  };
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json) as Partial<AnalysisOverall>;
    return {
      condition: oneOf(
        parsed.condition,
        ['good', 'fair', 'needs_attention', 'unknown'] as const,
        'unknown',
      ),
      goodNews: strings(parsed.goodNews),
      watchOut: strings(parsed.watchOut),
      areas: Array.isArray(parsed.areas)
        ? parsed.areas.filter((a) => a && typeof a.area === 'string')
        : [],
      questionsForDoctor: strings(parsed.questionsForDoctor),
      tips: strings(parsed.tips),
    };
  } catch {
    return empty;
  }
}

/** The date an analysis is filed under: the earliest printed date, else today. */
export function reportDateFor(reports: readonly ParsedReport[], fallback: Date): Date {
  const dates = reports
    .map((r) => r.reportDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? fallback;
}

/** Out of range in either direction — what the "needs a look" list shows. */
export function isOutOfRange(status: LabStatusKey): boolean {
  return status === 'low' || status === 'high' || status === 'abnormal' || status === 'borderline';
}

/*
 * ---------------------------------------------------------------------------
 * Where a value sits in its range — for the range bar
 * ---------------------------------------------------------------------------
 */

/**
 * The marker position on a three-zone bar (low | normal | high), as 0–1.
 *
 * The normal band always occupies the middle third, whatever its width in real
 * units: what the reader needs is "inside, below, or above — and by how much",
 * not a to-scale axis on which a narrow band is a sliver. Values outside are
 * placed proportionally within their outer third and clamped at the ends.
 * Null when there is no range to place against.
 */
export function rangePosition(
  value: number | null,
  refLow: number | null,
  refHigh: number | null,
): number | null {
  if (value === null) return null;
  if (refLow === null && refHigh === null) return null;

  // One-sided ranges ("< 200") get a synthetic other side so the bar still reads.
  const low = refLow ?? 0;
  const high = refHigh ?? (refLow !== null ? refLow * 2 : 1);
  const span = Math.max(high - low, Math.abs(high) * 0.1, 1e-6);

  let position: number;
  if (value < low) position = 1 / 3 - ((low - value) / span) * (1 / 3);
  else if (value > high) position = 2 / 3 + ((value - high) / span) * (1 / 3);
  else position = 1 / 3 + ((value - low) / span) * (1 / 3);

  return Math.min(1, Math.max(0, position));
}

/*
 * ---------------------------------------------------------------------------
 * Offline search — "what is my sugar level?"
 * ---------------------------------------------------------------------------
 */

/** The fields search and charts need from a stored result row. */
export interface LabResultLike {
  id: string;
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

/** Every result for one test, oldest first, with the latest picked out. */
export interface TestGroup<R extends LabResultLike = LabResultLike> {
  testKey: string;
  testName: string;
  category: string;
  unit: string | null;
  history: R[];
  latest: R;
}

/**
 * Words that carry no meaning in a question about results.
 *
 * "what is my sugar level" has one content word. Without this list "level"
 * and "my" would be matched against test names and return noise.
 */
const STOPWORDS = new Set(
  (
    'what whats is are my me i the a an of in on to for and or show tell give level levels ' +
    'value values result results reading readings how was were did do does about last latest ' +
    'current recent test tests report reports check much many any history trend chart please ' +
    'can you see find get have has had been ok okay normal'
  ).split(' '),
);

/**
 * Everyday words → the terms they should find.
 *
 * The AI also writes `searchTerms` onto every row, which covers most of this.
 * The map is the floor for results stored without good terms, and for the
 * common abbreviations people type (FBS, LDL, Hb) that no model reliably adds.
 */
export const SYNONYMS: Record<string, string[]> = {
  'blood sugar': ['glucose', 'hba1c', 'fbs', 'ppbs', 'rbs', 'sugar'],
  'blood count': ['blood count', 'hemoglobin', 'haemoglobin', 'platelet', 'wbc', 'rbc'],
  'blood pressure': ['blood pressure'],
  'uric acid': ['uric acid'],
  sugar: ['glucose', 'hba1c', 'blood sugar', 'fbs', 'ppbs', 'rbs', 'diabetes'],
  glucose: ['glucose', 'sugar', 'fbs', 'ppbs', 'rbs'],
  diabetes: ['glucose', 'hba1c', 'sugar'],
  fbs: ['fasting blood glucose', 'fasting glucose', 'fbs', 'fasting blood sugar'],
  hba1c: ['hba1c', 'a1c', 'glycated'],
  a1c: ['hba1c', 'a1c'],
  cholesterol: ['cholesterol', 'ldl', 'hdl', 'triglycerides', 'lipid', 'vldl'],
  lipid: ['cholesterol', 'ldl', 'hdl', 'triglycerides', 'lipid'],
  fat: ['cholesterol', 'triglycerides', 'lipid'],
  ldl: ['ldl'],
  hdl: ['hdl'],
  kidney: ['kidney', 'creatinine', 'urea', 'egfr', 'bun', 'renal'],
  kidneys: ['kidney', 'creatinine', 'urea', 'egfr', 'bun', 'renal'],
  liver: ['liver', 'alt', 'ast', 'sgpt', 'sgot', 'bilirubin', 'alp', 'ggt', 'albumin'],
  thyroid: ['thyroid', 'tsh', 't3', 't4'],
  hb: ['hemoglobin', 'haemoglobin'],
  hemoglobin: ['hemoglobin', 'haemoglobin'],
  haemoglobin: ['hemoglobin', 'haemoglobin'],
  blood: ['blood count', 'hemoglobin', 'haemoglobin', 'platelet', 'wbc', 'rbc'],
  anemia: ['hemoglobin', 'haemoglobin', 'iron', 'ferritin'],
  anaemia: ['hemoglobin', 'haemoglobin', 'iron', 'ferritin'],
  iron: ['iron', 'ferritin', 'hemoglobin'],
  vitamin: ['vitamin'],
  'vitamin d': ['vitamin d', 'vit d', '25 oh'],
  b12: ['b12', 'cobalamin'],
  uric: ['uric acid'],
  gout: ['uric acid'],
  platelets: ['platelet'],
  platelet: ['platelet'],
  wbc: ['wbc', 'white blood', 'leukocyte'],
  infection: ['wbc', 'crp', 'esr', 'white blood', 'neutrophil'],
  urine: ['urine'],
  heart: ['heart', 'troponin', 'cholesterol', 'ldl'],
  pressure: ['blood pressure'],
};

/** Lowercase words, punctuation removed. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** The content words of a question, with two-word phrases kept together. */
export function queryTerms(query: string): string[] {
  const all = words(query);
  const content = all.filter((word) => !STOPWORDS.has(word));
  // "vitamin d" is one idea; "d" alone would be dropped as too short.
  const terms: string[] = [];
  for (let i = 0; i < content.length; i += 1) {
    const pair = `${content[i]} ${content[i + 1] ?? ''}`.trim();
    if (SYNONYMS[pair]) {
      terms.push(pair);
      i += 1;
    } else if (content[i].length >= 2) {
      terms.push(content[i]);
    }
  }
  return terms;
}

/** Group rows into one entry per test. */
export function groupByTest<R extends LabResultLike>(rows: readonly R[]): TestGroup<R>[] {
  const byKey = new Map<string, R[]>();
  for (const row of rows) {
    const list = byKey.get(row.testKey) ?? [];
    list.push(row);
    byKey.set(row.testKey, list);
  }

  const groups: TestGroup<R>[] = [];
  for (const [testKey, list] of byKey) {
    const history = [...list].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
    const latest = history[history.length - 1];
    groups.push({
      testKey,
      testName: latest.testName,
      category: latest.category,
      unit: latest.unit,
      history,
      latest,
    });
  }
  return groups;
}

/** Everything about a group that search can match against, as padded text. */
function haystackFor(group: TestGroup): string {
  const parts = [
    group.testKey.replace(/_/g, ' '),
    group.category,
    ...group.history.map((r) => `${r.testName} ${r.searchTerms} ${r.bodyArea ?? ''}`),
  ];
  return ` ${words(parts.join(' ')).join(' ')} `;
}

/** Whether a phrase appears as whole words, or a long word as a prefix. */
function matches(haystack: string, phrase: string): boolean {
  if (haystack.includes(` ${phrase} `)) return true;
  // "choles" finds cholesterol; short fragments would match everything.
  return phrase.length >= 4 && !phrase.includes(' ') && haystack.includes(` ${phrase}`);
}

/**
 * Answer a plain-language question from stored results.
 *
 * Returns one group per matching test, best match first. A test scores a point
 * per query term it satisfies — directly, or through a synonym — and two
 * points when the term is in its own name, so "sugar" ranks fasting glucose
 * above a urine panel that merely mentions sugar.
 */
export function searchLabResults<R extends LabResultLike>(
  query: string,
  rows: readonly R[],
): TestGroup<R>[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const scored: { group: TestGroup<R>; score: number }[] = [];
  for (const group of groupByTest(rows)) {
    const haystack = haystackFor(group);
    const name = ` ${words(`${group.testName} ${group.testKey.replace(/_/g, ' ')}`).join(' ')} `;

    let score = 0;
    for (const term of terms) {
      const alternatives = [term, ...(SYNONYMS[term] ?? [])];
      if (alternatives.some((alt) => matches(name, alt))) score += 2;
      else if (alternatives.some((alt) => matches(haystack, alt))) score += 1;
    }
    if (score > 0) scored.push({ group, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.group.latest.measuredAt.getTime() - a.group.latest.measuredAt.getTime(),
    )
    .map((entry) => entry.group);
}

/** Suggested questions, from the tests this person actually has. */
export function suggestedQuestions(groups: readonly TestGroup[], limit = 4): string[] {
  const picks: string[] = [];
  const has = (needle: string) => groups.some((g) => haystackFor(g).includes(` ${needle}`));

  if (has('glucose') || has('hba1c')) picks.push('What is my sugar level?');
  if (has('cholesterol')) picks.push('How is my cholesterol?');
  if (has('creatinine') || has('kidney')) picks.push('Are my kidneys okay?');
  if (has('hemoglobin') || has('haemoglobin')) picks.push('What is my haemoglobin?');
  if (has('tsh') || has('thyroid')) picks.push('How is my thyroid?');
  if (has('liver')) picks.push('How is my liver?');
  return picks.slice(0, limit);
}

/** Titles that say nothing about the test — the model's or the letterhead's. */
const GENERIC_TITLE = /^(?:(?:medical|clinical|pathology|laboratory|lab|test|investigation|diagnostic)\s*)+(?:reports?|results?|investigations?)?$|^reports?$|^results?$/i;

const MAX_TITLE_LENGTH = 40;

/** Category → the name a file gets when the model gave none worth keeping. */
const CATEGORY_TITLE: Record<string, string> = {
  'Blood sugar': 'Blood sugar test',
  'Cholesterol & fats': 'Lipid profile',
  Kidney: 'Kidney function test',
  Liver: 'Liver function test',
  'Blood count': 'Full blood count',
  Thyroid: 'Thyroid test',
  'Vitamins & minerals': 'Vitamin test',
  Heart: 'Heart test',
  Urine: 'Urine test',
  'Infection & inflammation': 'Infection test',
  Hormones: 'Hormone test',
};

/**
 * A model title made fit for the list: sentence case when it SHOUTS, no lab
 * name tacked on, short. Null when nothing useful is left.
 */
export function simpleReportTitle(raw: string | null, labName: string | null = null): string | null {
  let title = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (labName) {
    const lab = labName.trim().toLowerCase();
    // "Lipid profile - Asiri Labs" → "Lipid profile"
    title = title
      .split(/\s+[·|–—-]\s+/)
      .filter((part) => part.trim().toLowerCase() !== lab)
      .join(' - ');
  }
  title = title.replace(/[\s.:·|–—-]+$/, '').trim();
  if (!title || GENERIC_TITLE.test(title)) return null;
  if (title === title.toUpperCase() && /[A-Z]{3}/.test(title)) {
    // Keep short acronyms (TSH, HbA1c is mixed so never here) upper-case.
    title = title
      .toLowerCase()
      .split(' ')
      .map((w, i) => (w.length <= 3 && /^[a-z0-9]+$/.test(w) && i > 0 ? w.toUpperCase() : w))
      .join(' ');
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    // Cut at the last whole word that fits; the +1 keeps a word ending exactly at the limit.
    const cut = title.slice(0, MAX_TITLE_LENGTH + 1);
    const space = cut.lastIndexOf(' ');
    title = (space > 15 ? cut.slice(0, space) : cut.slice(0, MAX_TITLE_LENGTH)).trim();
  }
  return title;
}

/**
 * The name a report has from upload until it is read: the file's own name,
 * tidied ("FBC_Asiri-2026.03.pdf" → "FBC Asiri 2026.03"), so the list says
 * which file is which while the AI works. Replaced by `documentTitles` once
 * the report is read. "Lab report" when there is no name (a camera photo).
 */
export function titleFromFileName(name: string | null | undefined): string {
  const base = (name ?? '')
    .replace(/\.(pdf|jpe?g|png|heic|heif|webp)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+-\s+|\s*-(?=\D)|(?<=\D)-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'Lab report';
  return base.length > 60 ? `${base.slice(0, 59).trim()}…` : base;
}

/**
 * One name per file sent. In order of preference: the model's title for that
 * file; a name from the categories of the results read off it; the previous
 * file's (a continuation page with no results of its own); "Lab report".
 */
export function documentTitles(
  extraction: { reports: readonly ParsedReport[]; results: readonly ParsedResult[] },
  fileCount: number,
): string[] {
  const titles: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const report = extraction.reports.find((r) => r.fileIndex === index);
    const own = simpleReportTitle(report?.title ?? null, report?.labName ?? null);
    titles.push(own ?? fromResults(extraction.results, index) ?? titles[index - 1] ?? 'Lab report');
  }
  return titles;
}

function fromResults(results: readonly ParsedResult[], fileIndex: number): string | null {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.fileIndex !== fileIndex || r.category === 'Other') continue;
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? (CATEGORY_TITLE[top] ?? null) : null;
}
