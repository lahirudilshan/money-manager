/**
 * "Ask AI" in Health records — the pure half: which model a question deserves,
 * whether it needs the web, what is sent about the person, and how the answer
 * and its sources are read back.
 *
 * ## What it answers from
 *
 * The person's OWN numbers first (every test's latest value, its range and the
 * last few values, the latest report's summary, medicines being taken), so
 * "is my sugar getting better?" is answered from their reports. Google Search
 * grounding is switched on only when the question is about the world rather
 * than the record — "what foods lower cholesterol?" — because a grounded call
 * is slower and spends a separate allowance.
 *
 * ## The right model for the question
 *
 * A short, personal question ("what was my last sugar?") is a lookup over the
 * context: Flash-Lite answers it in a second or two. A question that asks why,
 * compares, plans, or needs the web gets Flash first. Every list still falls
 * through to the others when one is busy or used up — same as report reading.
 */

import type { LabStatusKey } from './labReports';

export type QuestionDepth = 'quick' | 'deep';

export interface QuestionRoute {
  depth: QuestionDepth;
  /** Ground the answer in Google Search. */
  web: boolean;
  /** Models to try, best first. */
  models: readonly string[];
}

const LITE = 'gemini-flash-lite-latest';
const FLASH = 'gemini-flash-latest';
const FLASH_3 = 'gemini-3-flash-preview';

/** The model order per kind of question — see the header. */
export const ASK_MODELS: Record<QuestionDepth, readonly string[]> = {
  quick: [LITE, FLASH, FLASH_3],
  deep: [FLASH, FLASH_3, LITE],
};

/** About the record: "my", "last", "when did I"… */
const PERSONAL =
  /\b(my|me|mine|i|i'm|im|am i|our|his|her|their|last|latest|previous|recent|report|result|reading|trend|getting (better|worse)|since|when did)\b/i;

/** About the world: food, medicine, causes, what something is… */
const GENERAL =
  /\b(food|foods|eat|eating|diet|drink|fruit|vegetable|recipe|exercise|yoga|walk|medicine|medication|tablet|drug|dose|side effects?|vitamin|supplement|cause[sd]?|symptoms?|prevent|cure|treatment|research|study|studies|latest guidelines?|news|natural|home remed(y|ies)|what is|what are|what does|how does|how to|is it safe|ayurved\w*|herbal|interest rates?|exchange rates?|fixed deposits?|tax(es)?|inflation|invest\w*)\b/i;

/** Asks for reasoning, not a lookup. */
const DEEP =
  /\b(why|explain|compare|comparison|difference|plan|should i|risk|dangerous|serious|worried|worry|improve|reduce|lower|increase|raise|over time|trend|better|worse|all my|overall|summary|summari[sz]e|what does it mean)\b/i;

export function routeQuestion(question: string): QuestionRoute {
  const q = question.trim();
  const general = GENERAL.test(q);
  const personal = PERSONAL.test(q);
  // The web only when the question reaches beyond the record.
  const web = general && (!personal || /\b(food|eat|diet|medicine|tablet|drug|side effects?|supplement|exercise|treatment|guidelines?|rates?|tax|invest\w*)\b/i.test(q));
  const long = q.length > 120 || (q.match(/\?/g)?.length ?? 0) > 1;
  const depth: QuestionDepth = web || long || DEEP.test(q) ? 'deep' : 'quick';
  return { depth, web, models: ASK_MODELS[depth] };
}

/*
 * ---------------------------------------------------------------------------
 * What is sent about the person
 * ---------------------------------------------------------------------------
 */

export interface ContextPerson {
  name: string;
  age: number | null;
  sex: string | null;
  conditions: string | null;
  allergies: string | null;
}

export interface ContextValue {
  valueText: string;
  unit: string | null;
  status: LabStatusKey;
  measuredAt: Date;
}

export interface ContextSeries {
  testName: string;
  refLow: number | null;
  refHigh: number | null;
  /** Oldest first, as series carry them. */
  history: readonly ContextValue[];
}

export interface ContextReport {
  reportDate: Date;
  headline: string | null;
  summary: string | null;
  watchOut: readonly string[];
}

/** Cap on what one question sends — a family with years of reports stays small. */
const MAX_TESTS = 40;
const VALUES_PER_TEST = 4;

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function range(s: ContextSeries): string {
  if (s.refLow !== null && s.refHigh !== null) return `normal ${s.refLow}–${s.refHigh}`;
  if (s.refHigh !== null) return `normal under ${s.refHigh}`;
  if (s.refLow !== null) return `normal over ${s.refLow}`;
  return 'no range given';
}

/**
 * The person's record as compact text for the model. Only what a question
 * about health needs: no ids, no file names, no money.
 */
export function buildHealthContext(input: {
  person: ContextPerson;
  series: readonly ContextSeries[];
  latestReport: ContextReport | null;
  medicines: readonly string[];
  today: Date;
}): string {
  const p = input.person;
  const lines: string[] = [`Today: ${day(input.today)}`];
  lines.push(
    `Person: ${p.name}${p.age !== null ? `, ${p.age} years` : ''}${p.sex ? `, ${p.sex}` : ''}`,
  );
  if (p.conditions) lines.push(`Known conditions: ${p.conditions}`);
  if (p.allergies) lines.push(`Allergies: ${p.allergies}`);
  if (input.medicines.length > 0) lines.push(`Medicines now: ${input.medicines.join('; ')}`);

  if (input.latestReport) {
    const r = input.latestReport;
    lines.push('', `Latest report summary (${day(r.reportDate)}):`);
    if (r.headline) lines.push(r.headline);
    if (r.summary) lines.push(r.summary);
    if (r.watchOut.length > 0) lines.push(`Keep an eye on: ${r.watchOut.join('; ')}`);
  }

  if (input.series.length === 0) {
    lines.push('', 'No test results or readings are saved yet.');
  } else {
    lines.push('', 'Test results and readings (newest first, with earlier values):');
    for (const s of input.series.slice(0, MAX_TESTS)) {
      const values = [...s.history]
        .reverse()
        .slice(0, VALUES_PER_TEST)
        .map((v) => `${v.valueText}${v.unit ? ` ${v.unit}` : ''} ${v.status} on ${day(v.measuredAt)}`);
      lines.push(`- ${s.testName} (${range(s)}): ${values.join('; ')}`);
    }
    if (input.series.length > MAX_TESTS) {
      lines.push(`(${input.series.length - MAX_TESTS} more tests not listed)`);
    }
  }
  return lines.join('\n');
}

/*
 * ---------------------------------------------------------------------------
 * The instruction and the prompt
 * ---------------------------------------------------------------------------
 */

export const ASK_INSTRUCTION = [
  'You help a family understand their own health records. Many readers have little schooling and no medical training.',
  'Write so a 12-year-old understands: short sentences, everyday words, no jargon. If you must use a medical word, explain it in brackets.',
  'Answer the question first, in one or two sentences. Then add at most 4 short bullet points starting with "- " if they help. Keep the whole answer under 150 words.',
  'Use the person\'s saved records below when the question is about them. Name the value and its date ("Your fasting sugar was 142 on 3 Oct — that is high"). Say plainly if it is normal, high or low, and what to do.',
  'If the records do not hold the answer, say so plainly. Never invent a value, a date or a diagnosis.',
  'For general health facts, use Google Search when it is available and prefer trusted health sources.',
  'You are not a doctor. For anything that needs a decision about medicine or treatment, say to ask their doctor. Never tell anyone to start, stop or change a medicine.',
  'If the question describes an emergency (chest pain, trouble breathing, fainting, signs of stroke, very high or very low sugar with confusion), tell them to get emergency help now, first.',
  'Reply in the same language as the question. Plain text only: no markdown headings, bold, tables or links.',
].join('\n');

export interface ChatTurn {
  question: string;
  answer: string;
}

/** The conversation so far, the record, and the new question, as one prompt. */
export function buildAskPrompt(input: {
  context: string;
  earlier: readonly ChatTurn[];
  question: string;
}): string {
  const parts = ['SAVED RECORDS', input.context];
  const earlier = input.earlier.slice(-4);
  if (earlier.length > 0) {
    parts.push('', 'EARLIER IN THIS CHAT');
    for (const turn of earlier) parts.push(`Q: ${turn.question}`, `A: ${turn.answer}`);
  }
  parts.push('', 'QUESTION', input.question.trim());
  return parts.join('\n');
}

/*
 * ---------------------------------------------------------------------------
 * Reading the answer back
 * ---------------------------------------------------------------------------
 */

export interface AnswerSource {
  title: string;
  uri: string;
}

/** The web pages a grounded answer drew on, deduplicated, at most five. */
export function sourcesFrom(groundingMetadata: unknown): AnswerSource[] {
  const chunks =
    (groundingMetadata as { groundingChunks?: { web?: { uri?: string; title?: string } }[] } | null)
      ?.groundingChunks ?? [];
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ title: chunk.web?.title?.trim() || 'Web page', uri });
    if (out.length === 5) break;
  }
  return out;
}

/** Markdown the model slipped in anyway, removed — the screen draws plain text. */
export function cleanAnswer(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[*•][ \t]+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A test name mid-sentence: no brackets, lower case unless an acronym — "liver enzyme", "LDL cholesterol". */
export function inSentence(name: string): string {
  const bare = name.replace(/\s*\([^)]*\)/g, '').replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  const [first, ...rest] = bare.split(' ');
  const word = /^[A-Z0-9]{2,}$/.test(first) ? first : first.toLowerCase();
  return [word, ...rest].join(' ');
}

/** Starter questions from what the person actually has. */
export function starterQuestions(
  series: readonly { testName: string; latest: { status: LabStatusKey } }[],
  limit = 4,
): string[] {
  const picks: string[] = [];
  const flagged = series.filter((s) => s.latest.status !== 'normal' && s.latest.status !== 'unknown');
  if (series.length > 0) picks.push('Explain my latest results in simple words');
  for (const s of flagged.slice(0, 2)) {
    picks.push(`My ${inSentence(s.testName)} is ${s.latest.status === 'low' ? 'low' : 'high'}. What should I do?`);
  }
  if (flagged[0]) picks.push(`What foods help with my ${inSentence(flagged[0].testName)}?`);
  if (series.length > 0) picks.push('Is anything getting worse over time?');
  picks.push('What questions should I ask my doctor?');
  return [...new Set(picks)].slice(0, limit);
}

/*
 * ---------------------------------------------------------------------------
 * The daily question count
 * ---------------------------------------------------------------------------
 */

/** Questions per phone per day on Dayly's shared allowance — a cost guard. */
export const DAILY_QUESTION_LIMIT = 20;

export interface QuestionLog {
  day: string;
  count: number;
}

export function localDayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

export function parseQuestionLog(raw: string | null | undefined): QuestionLog {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<QuestionLog>) : null;
    if (value && typeof value.day === 'string' && typeof value.count === 'number') {
      return { day: value.day, count: value.count };
    }
  } catch {
    // fall through
  }
  return { day: '', count: 0 };
}

export function questionsUsedToday(log: QuestionLog, now: Date): number {
  return log.day === localDayKey(now) ? log.count : 0;
}

export function addQuestion(log: QuestionLog, now: Date): QuestionLog {
  const today = localDayKey(now);
  return { day: today, count: (log.day === today ? log.count : 0) + 1 };
}
