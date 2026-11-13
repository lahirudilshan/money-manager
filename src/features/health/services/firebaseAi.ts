import { recordAiCall, type AllowanceOwner } from './aiQuotaStore';
import Constants from 'expo-constants';
import type { FirebaseApp } from 'firebase/app';
import type { GenerationConfig, GenerativeModel, Part, Tool } from 'firebase/ai';
import {
  appCheckExpiry,
  describeGeminiError,
  describeTiming,
  EXPLANATION_JSON_SCHEMA,
  EXTRACTION_JSON_SCHEMA,
  isThinkingConfigError,
  isTransientNetworkError,
  MODELS_FOR,
  parseJsonText,
  statusFromError,
  thinkingConfigFor,
  worthAnotherModel,
  type AnalysisTask,
  type CallTiming,
} from '~/features/health/logic/gemini';
import { generateWithUserKey } from './geminiRest';
import { userGeminiKey, userGeminiKeyCached } from './userGemini';

/**
 * Gemini through Firebase AI Logic — no key on the phone, nothing for the user
 * to set up.
 *
 * ## App Check
 *
 * AI Logic only answers requests carrying an App Check token, which is how a
 * request is known to come from the real Dayly app and not from someone who
 * lifted the Firebase config out of it. Native attestation (App Attest) needs
 * the native Firebase SDK; until that lands, DEVELOPMENT builds prove
 * themselves with a debug token from `.env.local`, exchanged over App Check's
 * REST API. A release build has no debug token and the feature reports itself
 * unavailable rather than sending requests that would be refused.
 */

interface FirebaseConfig {
  apiKey: string;
  appId: string;
  projectId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

function config(): FirebaseConfig | null {
  const value = Constants.expoConfig?.extra?.firebase as Partial<FirebaseConfig> | undefined;
  if (!value?.apiKey || !value.appId || !value.projectId) return null;
  return value as FirebaseConfig;
}

/**
 * The App Check debug token, DEVELOPMENT BUILDS ONLY.
 *
 * Inlined by Metro from `.env.local`. A debug token lets anyone holding it pass
 * App Check, so it must never reach a shipped bundle: `__DEV__` is a constant
 * `false` in release builds, the minifier drops the dead branch along with the
 * literal, and a release build reports AI as unavailable until native App
 * Attest replaces this. If a build carrying it is ever distributed, revoke the
 * token in Firebase console → App Check → Manage debug tokens.
 */
const DEBUG_TOKEN: string = __DEV__ ? (process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN ?? '') : '';

/** Whether AI reading can run on this build at all. */
export function isAiAvailable(): boolean {
  return userGeminiKeyCached() !== null || (config() !== null && DEBUG_TOKEN.length > 0);
}

/** Whether reports go to the user's own Google allowance rather than Dayly's. */
export function usesOwnGoogleAi(): boolean {
  return userGeminiKeyCached() !== null;
}

/** Trade the debug token for a short-lived App Check token. */
async function exchangeDebugToken(cfg: FirebaseConfig) {
  const url =
    `https://content-firebaseappcheck.googleapis.com/v1/projects/${cfg.projectId}` +
    `/apps/${cfg.appId}:exchangeDebugToken?key=${cfg.apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debug_token: DEBUG_TOKEN }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: string;
    ttl?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.token) {
    throw new Error(`App Check ${response.status}: ${body.error?.message ?? 'no token'}`);
  }
  return { token: body.token, expireTimeMillis: appCheckExpiry(body.ttl, Date.now()) };
}

let app: FirebaseApp | null = null;

/** Models that answered 400 to a thinking setting this session. */
const rejectedThinking = new Set<string>();

/**
 * The Firebase SDK, loaded on first use — never at app start.
 *
 * expo-router evaluates every route module at launch, and the AI screen
 * imports this file. Importing the SDK at the top therefore ran Firebase's
 * initialisation code during app start-up, before the app had rendered; a
 * throw there left React half-initialised ("RCTEventEmitter … not registered")
 * on every launch, for every user, whether or not they ever opened Health.
 * Loading it inside the call confines any such failure to the one action that
 * needs Firebase, where it is caught and shown as an ordinary error.
 */
function sdk() {
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    app: require('firebase/app') as typeof import('firebase/app'),
    appCheck: require('firebase/app-check') as typeof import('firebase/app-check'),
    ai: require('firebase/ai') as typeof import('firebase/ai'),
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}

function firebaseApp(cfg: FirebaseConfig): FirebaseApp {
  const { getApp, getApps, initializeApp } = sdk().app;
  const { CustomProvider, initializeAppCheck } = sdk().appCheck;
  if (app) return app;
  app = getApps().length > 0 ? getApp() : initializeApp(cfg);
  initializeAppCheck(app, {
    provider: new CustomProvider({ getToken: () => exchangeDebugToken(cfg) }),
    // The SDK refreshes on demand when a request needs a token; a background
    // timer would only spend requests while the app sits unused.
    isTokenAutoRefreshEnabled: false,
  });
  return app;
}

export interface InlineFile {
  mimeType: string;
  base64: string;
}

type Generate = (
  model: string,
  generationConfig: Record<string, unknown>,
) => Promise<{ text: string; timing: CallTiming; grounding?: unknown }>;

/**
 * One way to call a model, whoever pays: the user's own Google key first
 * (their project, their free allowance), else Dayly's Firebase project.
 */
async function prepareGenerator(input: {
  files: readonly InlineFile[];
  systemInstruction: string;
  prompt: string;
  tools?: readonly Record<string, unknown>[];
  onLog?: (line: string) => void;
  onPartial?: (textSoFar: string) => void;
}): Promise<
  { ok: true; generate: Generate; owner: AllowanceOwner } | { ok: false; error: string }
> {
  const user = await userGeminiKey();
  if (user) {
    const restParts = [
      ...input.files.map((file) => ({ inlineData: { mimeType: file.mimeType, data: file.base64 } })),
      { text: input.prompt },
    ];
    return {
      ok: true,
      owner: 'own',
      generate: (model, generationConfig) =>
        generateWithUserKey({
          key: user.key,
          model,
          systemInstruction: input.systemInstruction,
          parts: restParts,
          generationConfig,
          tools: input.tools,
          onPartial: input.onPartial,
        }),
    };
  }

  const cfg = config();
  if (!cfg || !DEBUG_TOKEN) {
    return { ok: false, error: 'AI is not available in this version of the app.' };
  }
  let firebase: ReturnType<typeof sdk>;
  let ai: ReturnType<ReturnType<typeof sdk>['ai']['getAI']>;
  try {
    firebase = sdk();
    ai = firebase.ai.getAI(firebaseApp(cfg), { backend: new firebase.ai.GoogleAIBackend() });
  } catch (error) {
    return {
      ok: false,
      error: `AI could not start on this phone (${error instanceof Error ? error.message : 'unknown error'}).`,
    };
  }
  const parts: Part[] = [
    ...input.files.map(
      (file): Part => ({
        type: 'inlineData',
        inlineData: { mimeType: file.mimeType, data: file.base64 },
      }),
    ),
    { type: 'text', text: input.prompt },
  ];
  return {
    ok: true,
    owner: 'shared',
    generate: (model, generationConfig) =>
      answerText(
        firebase.ai.getGenerativeModel(ai, {
          model,
          systemInstruction: input.systemInstruction,
          generationConfig: generationConfig as GenerationConfig,
          ...(input.tools ? { tools: input.tools as unknown as Tool[] } : {}),
        }),
        parts,
        input.onPartial,
        input.onLog,
      ),
  };
}

/**
 * A plain-text answer — "Ask AI" in Health records.
 *
 * The caller picks the models for the question (see `routeQuestion`); a
 * busy, retired or used-up model falls through to the next, and every call
 * is counted against the same free allowance report reading uses.
 */
export async function generateAnswerText(input: {
  models: readonly string[];
  systemInstruction: string;
  prompt: string;
  /** Ground the answer in Google Search. */
  web: boolean;
  onPartial?: (textSoFar: string) => void;
}): Promise<
  | { ok: true; text: string; grounding: unknown; model: string; owner: AllowanceOwner }
  | { ok: false; error: string }
> {
  const prepared = await prepareGenerator({
    files: [],
    systemInstruction: input.systemInstruction,
    prompt: input.prompt,
    tools: input.web ? [{ googleSearch: {} }] : undefined,
    onPartial: input.onPartial,
  });
  if (!prepared.ok) return prepared;
  const { generate, owner } = prepared;

  let lastError = 'No AI model answered. Try again in a minute.';
  for (const model of input.models) {
    let thinking = rejectedThinking.has(model) ? undefined : thinkingConfigFor(model, 'explain');
    let networkRetried = false;
    for (;;) {
      try {
        const { text, timing, grounding } = await generate(model, {
          temperature: 0.3,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        });
        recordAiCall(owner, { model, ok: true });
        if (__DEV__) console.log(`[gemini ask${input.web ? '+web' : ''}] ${model}: ${describeTiming(timing)}`);
        if (!text.trim()) return { ok: false, error: 'The AI returned nothing. Try asking another way.' };
        return { ok: true, text, grounding, model, owner };
      } catch (error) {
        const status = statusFromError(error);
        const message = error instanceof Error ? error.message : String(error);
        recordAiCall(owner, { model, ok: false, status, body: message });
        if (__DEV__) console.log(`[gemini ask] ${model} failed (${status}): ${message}`);
        if (thinking && isThinkingConfigError(status, message)) {
          rejectedThinking.add(model);
          thinking = undefined;
          continue;
        }
        if (!networkRetried && isTransientNetworkError(status, message)) {
          networkRetried = true;
          continue;
        }
        lastError = describeGeminiError(status, message);
        if (!worthAnotherModel(status)) return { ok: false, error: lastError };
        break;
      }
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Send the files and the instruction, returning the parsed JSON reply.
 *
 * Falls through the model list on "not found", "busy" and "at limit" — the
 * next model may well succeed — and stops on anything else, which another
 * model would hit in exactly the same way.
 */
export async function generateAnalysisJson(input: {
  /** Which of the two calls — picks the schema and how much the model thinks. */
  task: AnalysisTask;
  /** A JSON Schema for the reply, in place of the task's own (lab) schema. */
  schema?: Record<string, unknown>;
  files: readonly InlineFile[];
  /** The fixed rules — identical across calls, so Gemini can cache them. */
  systemInstruction: string;
  prompt: string;
  /** One line per thing that happens — for the progress log on screen. */
  onLog?: (line: string) => void;
  /** The answer so far, each time more of it arrives. */
  onPartial?: (textSoFar: string) => void;
}): Promise<{ ok: true; data: unknown; model: string } | { ok: false; error: string }> {
  const prepared = await prepareGenerator(input);
  if (!prepared.ok) return prepared;
  const { generate, owner } = prepared;

  const schema =
    input.schema ?? (input.task === 'extract' ? EXTRACTION_JSON_SCHEMA : EXPLANATION_JSON_SCHEMA);
  let lastError = 'No AI model answered. Try again in a minute.';
  for (const [attempt, model] of MODELS_FOR[input.task].entries()) {
    if (attempt > 0) input.onLog?.('Trying again');
    let thinking = rejectedThinking.has(model) ? undefined : thinkingConfigFor(model, input.task);
    let networkRetried = false;
    // A few tries per model: without a thinking setting this model rejected,
    // and once more after a dropped connection.
    for (;;) {
      try {
        const { text, timing } = await generate(model, {
          // Reading numbers off a page is not a creative task.
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        });
        // The model name stays out of what the user reads; the dev console
        // keeps it for diagnosing which model was slow.
        recordAiCall(owner, { model, ok: true });
        input.onLog?.(describeTiming(timing));
        if (__DEV__) console.log(`[gemini ${input.task}] ${model}: ${describeTiming(timing)}`);
        const parsed = parseJsonText(text);
        return parsed.ok ? { ok: true, data: parsed.data, model } : parsed;
      } catch (error) {
        const status = statusFromError(error);
        const message = error instanceof Error ? error.message : String(error);
        recordAiCall(owner, { model, ok: false, status, body: message });
        if (__DEV__) console.log(`[gemini ${input.task}] ${model} failed (${status}): ${message}`);
        if (thinking && isThinkingConfigError(status, message)) {
          // Remembered for the rest of the session, so the next call does
          // not spend a round trip on the same 400.
          rejectedThinking.add(model);
          thinking = undefined;
          continue;
        }
        if (!networkRetried && isTransientNetworkError(status, message)) {
          networkRetried = true;
          input.onLog?.('Connection dropped, trying again');
          continue;
        }
        lastError = describeGeminiError(status, message);
        // In a dev build the App Check failure is almost always the debug token
        // not being registered in Firebase — say so, with Google's own words,
        // instead of the "update the app" a user would see.
        if (__DEV__ && /app check|attestation/i.test(message)) {
          lastError =
            'App Check refused this dev build. Register the debug token (EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN in .env.local) in Firebase console → App Check → Apps → Dayly iOS → Manage debug tokens.' +
            `\n\n${message}`;
        }
        input.onLog?.(`Gemini could not answer${status ? ` (${status})` : ''}: ${lastError}`);
        // A model the account can't use (404) — the next one may work.
        if (!worthAnotherModel(status)) return { ok: false, error: lastError };
        break;
      }
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Whether streaming works on this phone. Unknown until first tried; set false
 * the first time a stream fails before a single byte arrives, so later
 * analyses go straight to the one-shot call.
 */
let streamingWorks: boolean | null = null;

/**
 * Gemini's full answer — streamed when possible, so the screen can show each
 * test as Gemini writes it.
 *
 * Expo installs its own `fetch` as the global one, and that one can read a
 * response as it arrives; Firebase's `generateContentStream` uses it. If the
 * stream breaks before anything arrives (an older runtime, a proxy that
 * buffers), the same request is made once more without streaming — the
 * answer is the same, only the progress is coarser. A stream that fails
 * part-way is a real error and is thrown like any other.
 */
async function answerText(
  generative: GenerativeModel,
  parts: Part[],
  onPartial: ((text: string) => void) | undefined,
  onLog: ((line: string) => void) | undefined,
): Promise<{ text: string; timing: CallTiming; grounding?: unknown }> {
  const startedAt = Date.now();
  if (onPartial && streamingWorks !== false) {
    let text = '';
    let firstChunkMs: number | null = null;
    try {
      const result = await generative.generateContentStream(parts);
      for await (const chunk of result.stream) {
        firstChunkMs ??= Date.now() - startedAt;
        text += chunk.text();
        onPartial(text);
      }
      streamingWorks = true;
      const final = await result.response.catch(() => null);
      return {
        text,
        timing: { firstChunkMs, totalMs: Date.now() - startedAt, usage: final?.usageMetadata ?? null },
        grounding: final?.candidates?.[0]?.groundingMetadata,
      };
    } catch (error) {
      // An HTTP error (refused, quota, busy) is the same either way: rethrow.
      if (text.length > 0 || statusFromError(error) !== 0 || streamingWorks === true) throw error;
      streamingWorks = false;
      onLog?.('Live updates unavailable — waiting for the full answer');
    }
  }
  const result = await generative.generateContent(parts);
  return {
    text: result.response.text(),
    timing: {
      firstChunkMs: null,
      totalMs: Date.now() - startedAt,
      usage: result.response.usageMetadata ?? null,
    },
    grounding: result.response.candidates?.[0]?.groundingMetadata,
  };
}
