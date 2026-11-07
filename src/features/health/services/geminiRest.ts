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
  onPartial?: (text: string) => void;
}): Promise<{ text: string; timing: CallTiming }> {
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
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
    } catch {
      // Not JSON — keep the raw text.
    }
    throw new Error(`[${response.status}] ${message}`);
  }

  let text = '';
  let usage: Record<string, number> | null = null;
  let firstChunkMs: number | null = null;
  const take = (events: unknown[]) => {
    for (const event of events) {
      const piece = responseText(event);
      if (piece) {
        firstChunkMs ??= Date.now() - startedAt;
        text += piece;
        input.onPartial?.(text);
      }
      usage = responseUsage(event) ?? usage;
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

  return { text, timing: { firstChunkMs, totalMs: Date.now() - startedAt, usage } };
}
