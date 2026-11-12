import { fetch as expoFetch } from 'expo/fetch';
import type { CallTiming } from '~/features/health/logic/gemini';
import {
  geminiRestUrl,
  readSse,
  responseText,
  responseUsage,
} from '~/features/health/logic/userGemini';
import { appBundleId } from './userGemini';

/**
 * Gemini called straight from the phone with the USER'S own key — their
 * project, their free allowance. Same request shape as Firebase AI Logic
 * sends; only the address and the credential differ.
 *
 * `expo/fetch`, not the global fetch: it can read the reply as it streams in,
 * so the screen shows each result as Gemini writes it.
 *
 * Errors are thrown as `Error("[status] message")` so `statusFromError` and
 * `describeGeminiError` read them exactly like Firebase's.
 */
export async function generateWithUserKey(input: {
  key: string;
  model: string;
  systemInstruction: string;
  parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[];
  generationConfig: Record<string, unknown>;
  /** e.g. `[{ googleSearch: {} }]` to ground the answer in Google Search. */
  tools?: readonly Record<string, unknown>[];
  onPartial?: (text: string) => void;
}): Promise<{ text: string; timing: CallTiming; grounding?: unknown }> {
  const startedAt = Date.now();
  const response = await expoFetch(geminiRestUrl(input.model, true), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': input.key,
      // The key only works for this app; Google checks this header.
      'X-Ios-Bundle-Identifier': appBundleId(),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.systemInstruction }] },
      contents: [{ role: 'user', parts: input.parts }],
      generationConfig: input.generationConfig,
      ...(input.tools ? { tools: input.tools } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as {
        error?: {
          message?: string;
          details?: { violations?: { quotaId?: string; quotaValue?: string }[] }[];
        };
      };
      message = parsed.error?.message ?? body;
      // Which allowance ran out, and its size — the free-allowance meter in
      // Settings reads these (see logic/aiQuota.ts).
      const violation = parsed.error?.details?.flatMap((d) => d.violations ?? [])[0];
      if (violation?.quotaId) message += ` (quotaId: ${violation.quotaId}`;
      if (violation?.quotaId && violation.quotaValue) message += `, quotaValue: ${violation.quotaValue}`;
      if (violation?.quotaId) message += ')';
    } catch {
      // Not JSON — keep the raw text.
    }
    throw new Error(`[${response.status}] ${message}`);
  }

  let text = '';
  let usage: Record<string, number> | null = null;
  let firstChunkMs: number | null = null;
  let grounding: unknown;
  const take = (events: unknown[]) => {
    for (const event of events) {
      const piece = responseText(event);
      if (piece) {
        firstChunkMs ??= Date.now() - startedAt;
        text += piece;
        input.onPartial?.(text);
      }
      usage = responseUsage(event) ?? usage;
      const meta = (event as { candidates?: { groundingMetadata?: unknown }[] })?.candidates?.[0]
        ?.groundingMetadata;
      if (meta) grounding = meta;
    }
  };

  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const read = readSse(buffer);
      buffer = read.rest;
      take(read.events);
    }
    take(readSse(`${buffer}\n`).events);
  } else {
    take(readSse(`${await response.text()}\n`).events);
  }

  return { text, timing: { firstChunkMs, totalMs: Date.now() - startedAt, usage }, grounding };
}
