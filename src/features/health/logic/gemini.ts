/**
 * The pure half of talking to Gemini through Firebase AI Logic.
 *
 * ## Why Firebase, not a key per user
 *
 * The first version asked every user to create a Gemini API key in Google AI
 * Studio and paste it in. Nobody outside development knows what an API key is,
 * so the feature was effectively closed to the people it was for. Firebase AI
 * Logic calls Gemini on the app's own Firebase project instead: the user signs
 * in with Google (the same sign-in as Drive) and agrees once, and that is all.
 *
 * The network call lives in `features/health/services/firebaseAi.ts`; the
 * rules — which models, what an error means to a person, the schema — live
 * here so they are tested without a device.
 */

import {
  ANALYSIS_RESPONSE_SCHEMA,
  EXPLANATION_RESPONSE_SCHEMA,
  EXTRACTION_RESPONSE_SCHEMA,
} from './labReports';

/**
 * Models to try per call, best first; a retired, busy or over-quota model
 * falls through to the next. `gemini-flash-latest` is Google's moving alias
 * for the current Flash, so the list keeps up with releases on its own.
 *
 * Reading numbers off a scanned page is where accuracy matters, so it gets
 * Flash. Explaining already-read results is plain text in, plain text out —
 * Flash-Lite does it in a fraction of the time, with Flash behind it.
 */
export const MODELS_FOR: Record<AnalysisTask, readonly string[]> = {
  /*
   * Measured 2026-11-07 on real reports: each model has its OWN free-tier
   * daily quota, so when one answers 429 the next is a real second chance.
   * Flash read 2 results off an HbA1c report where Flash-Lite read 1, so
   * Lite is the last resort for reading, not the first choice.
   * `gemini-2.5-flash` answers 404 ("no longer available to new users").
   */
  extract: ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest'],
  explain: ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-flash-latest'],
};

/** Inline request bodies are capped at 20 MB; base64 inflates by 4/3. */
export const MAX_INLINE_BYTES = 14 * 1024 * 1024;

/** How many analyses may run per day on this phone — a cost guard. */
export const DAILY_ANALYSIS_LIMIT = 10;

/** An error worded for the person holding the phone. */
export function describeGeminiError(status: number, body: string): string {
  const text = body.toLowerCase();
  if (text.includes('app check') || text.includes('attestation')) {
    return 'This copy of the app could not be verified by Google. Update the app and try again.';
  }
  if (status === 401 || status === 403) return 'Google refused the request. Try again later.';
  if (status === 429 && /per day|requests_per_day|perday/i.test(text)) {
    return 'Today’s free AI reading limit has been used up. Try again tomorrow — your reports are saved.';
  }
  if (status === 429 || text.includes('quota') || text.includes('resource_exhausted')) {
    return 'The AI is at its limit right now. Try again in a minute.';
  }
  if (status === 413 || text.includes('too large') || text.includes('payload')) {
    return 'The files are too large to send together. Try fewer pages at a time.';
  }
  if (status >= 500) return 'Google’s AI service is busy right now. Try again in a minute.';
  if (status === 0) return 'No connection. Check your internet and try again.';
  return `The AI service returned an error (${status}).`;
}

/** Whether the next model on the list might succeed where this one failed. */
export function worthAnotherModel(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

/** The HTTP status behind a Firebase AI error, or 0 when there was none. */
export function statusFromError(error: unknown): number {
  const data = (error as { customErrorData?: { status?: number } } | null)?.customErrorData;
  if (typeof data?.status === 'number') return data.status;
  const match = /\[(\d{3})[^\]]*\]/.exec(String((error as Error | null)?.message ?? ''));
  return match ? Number(match[1]) : 0;
}

/** Parse the model's text as JSON; a fenced block is accepted too. */
export function parseJsonText(
  text: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: 'The AI returned nothing. Try a clearer photo.' };
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return { ok: true, data: JSON.parse(cleaned) };
  } catch {
    return { ok: false, error: 'The AI reply could not be read. Try again, or send fewer pages.' };
  }
}

type SchemaNode = { [key: string]: unknown };

/**
 * Convert the Gemini-style schema (upper-case types, `nullable`) to standard
 * JSON Schema, which is what the SDK's `responseJsonSchema` takes.
 *
 * A conversion rather than a rewrite of `ANALYSIS_RESPONSE_SCHEMA`, so the
 * schema reads the way Gemini's docs write it and the transport is a detail.
 */
export function toJsonSchema(schema: SchemaNode): SchemaNode {
  const out: SchemaNode = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable') continue;
    if (key === 'type' && typeof value === 'string') {
      const type = value.toLowerCase();
      out.type = schema.nullable ? [type, 'null'] : type;
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, SchemaNode>).map(([k, v]) => [k, toJsonSchema(v)]),
      );
    } else if (key === 'items' && value && typeof value === 'object') {
      out.items = toJsonSchema(value as SchemaNode);
    } else if (Array.isArray(value)) {
      out[key] = [...value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const ANALYSIS_JSON_SCHEMA = toJsonSchema(ANALYSIS_RESPONSE_SCHEMA as unknown as SchemaNode);
export const EXTRACTION_JSON_SCHEMA = toJsonSchema(
  EXTRACTION_RESPONSE_SCHEMA as unknown as SchemaNode,
);
export const EXPLANATION_JSON_SCHEMA = toJsonSchema(
  EXPLANATION_RESPONSE_SCHEMA as unknown as SchemaNode,
);

/** The two calls an analysis makes — see "Two calls" in labReports.ts. */
export type AnalysisTask = 'extract' | 'explain';

/**
 * How much the model may think before answering.
 *
 * Left unset, Flash thinks at length by default, and that thinking happened
 * with the pages attached — the likeliest cause of DEADLINE_EXCEEDED on long
 * reports. Copying numbers off a page needs next to none; writing the
 * explanation benefits from a little.
 *
 * Gemini 2.5 only takes a token budget; later models take a level, and error
 * if given both. `gemini-flash-latest` moves between generations, so the
 * caller retries once without this if the model rejects it
 * (`isThinkingConfigError`).
 */
export function thinkingConfigFor(
  model: string,
  task: AnalysisTask,
): { thinkingBudget: number } | { thinkingLevel: string } | undefined {
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: task === 'extract' ? 0 : 512 };
  // Flash-Lite thinks little by default; setting a level only risks a 400.
  if (/lite/.test(model)) return undefined;
  // 'low', not 'minimal': gemini-flash-latest answers 400 "Thinking level
  // MINIMAL is not supported for this model" (seen 2026-11-07).
  return { thinkingLevel: 'low' };
}

/**
 * A dropped connection — "The network connection was lost" (status 0 with no
 * HTTP reply). Usually iOS reusing a connection the server already closed;
 * the same request a moment later goes through.
 */
export function isTransientNetworkError(status: number, message: string): boolean {
  return status === 0 && /connection was lost|timed out|network request failed|fetch failed/i.test(message);
}

/** A 400 about the thinking settings — worth one retry without them. */
export function isThinkingConfigError(status: number, message: string): boolean {
  return (status === 400 || status === 0) && /thinking/i.test(message);
}

export interface CallTiming {
  /** ms from sending to the first streamed chunk, when streamed. */
  firstChunkMs: number | null;
  totalMs: number;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  } | null;
}

/**
 * One log line saying where the time went — "Answered in 14.2s · first word
 * 3.1s · in 2,580 · thinking 0 · out 1,940 tokens". No model name: the user
 * reads this log. Shown in the analysis log, so a
 * slow or failed run says whether reading the pages (time to first word,
 * input tokens) or writing the answer (output and thinking tokens) was slow.
 */
export function describeTiming(t: CallTiming): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString('en-US');
  const parts = [
    `Answered in ${s(t.totalMs)}`,
    ...(t.firstChunkMs !== null ? [`first word ${s(t.firstChunkMs)}`] : []),
  ];
  if (t.usage) {
    parts.push(
      `in ${n(t.usage.promptTokenCount)}` +
        (t.usage.cachedContentTokenCount ? ` (${n(t.usage.cachedContentTokenCount)} cached)` : ''),
      `thinking ${n(t.usage.thoughtsTokenCount)}`,
      `out ${n(t.usage.candidatesTokenCount)} tokens`,
    );
  }
  return parts.join(' · ');
}

/** How many of these timestamps fall on today — the daily limit check. */
export function analysesToday(analysedAt: readonly Date[], now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return analysedAt.filter((d) => d.getTime() >= start).length;
}

/**
 * An App Check token's lifetime, from the exchange response's `ttl` ("3600s"),
 * as an absolute expiry. Renewed five minutes early so a long analysis never
 * starts on a token about to lapse.
 */
export function appCheckExpiry(ttl: unknown, now: number): number {
  const seconds = typeof ttl === 'string' ? parseFloat(ttl) : NaN;
  const life = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30 * 60 * 1000;
  return now + Math.max(60_000, life - 5 * 60 * 1000);
}
