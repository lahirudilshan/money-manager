/**
 * Fill a form from a photo or PDF with Gemini — see logic/aiForm.ts.
 *
 * AI is optional everywhere it is used: `aiFillBlocked()` says why it cannot
 * run (not set up, switched off, not agreed to), and every caller keeps its
 * form fully usable by hand.
 */

import { File } from 'expo-file-system';
import {
  formInstruction,
  knowledgeInstruction,
  readForm,
  schemaFor,
  type FormSpec,
  type FormValues,
} from '~/features/ai/logic/aiForm';
import { MAX_INLINE_BYTES } from '~/features/health/logic/gemini';
import { shrinkPhoto } from '~/features/health/services/analyseReports';
import { hasAiConsent, isAiEnabled } from '~/features/health/services/aiSettings';
import { generateAnalysisJson, isAiAvailable } from '~/features/health/services/firebaseAi';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { parseImageRef } from '~/shared/lib/imageRef';
import { withLiveWork } from '~/shared/lib/liveWork';

/**
 * How an AI job shows while it runs off-screen, and what it says when done.
 * See shared/lib/liveWork.ts: the app keeps running if the phone is locked or
 * the user switches apps, iOS shows the progress, and a notification lands
 * when it finishes while they are away.
 */
export interface AiLive {
  /** Lock Screen title — "Reading your garage bill". */
  title: string;
  /** Lock Screen subtitle — the vehicle's name, say. */
  subtitle: string;
  /** Usual duration in seconds; shapes the progress bar. */
  expectedSeconds?: number;
  /** Notification when it worked — "Hyundai Venue: 6 lines read". */
  done: { title: string; body: string };
  /** Notification when it did not. */
  failed: { title: string; body: string };
}

/** Run an AI call as live work; a failure result is announced like a throw. */
async function live<R extends { ok: boolean }>(spec: AiLive | undefined, work: () => Promise<R>): Promise<R> {
  if (!spec) return work();
  return withLiveWork(
    {
      title: spec.title,
      subtitle: spec.subtitle,
      expectedSeconds: spec.expectedSeconds ?? 15,
      done: (result) => (result.ok ? spec.done : spec.failed),
      failed: spec.failed,
    },
    work,
  );
}

/** Why AI reading cannot run right now, or null when it can. */
export function aiFillBlocked(): string | null {
  if (!isAiAvailable()) return 'AI reading is not set up on this build.';
  if (!isAiEnabled() || !hasAiConsent()) return 'Turn on AI features in Settings → AI to fill this in from a photo.';
  return null;
}

export interface AiFillRequest<S extends FormSpec> {
  /** The fields wanted, each with what to look for. */
  form: S;
  /** "a garage invoice or job card" — also checked: a wrong photo is refused. */
  documentKind: string;
  /** One sentence on what the form is for. */
  purpose: string;
  /** Extra rules beyond the per-field descriptions. */
  rules?: readonly string[];
  /** Facts the model needs that are not in the file (the vehicle, its list). */
  context?: string;
  /** Stored attachment reference (or a local path). */
  fileUri: string;
  onLog?: (line: string) => void;
  /** Keep going off-screen and notify when done — see `AiLive`. */
  live?: AiLive;
}

export async function aiFill<S extends FormSpec>(
  request: AiFillRequest<S>,
): Promise<{ ok: true; values: FormValues<S> } | { ok: false; error: string }> {
  if (aiFillBlocked()) return { ok: false, error: aiFillBlocked()! };
  return live(request.live, () => readFile(request));
}

async function readFile<S extends FormSpec>(
  request: AiFillRequest<S>,
): Promise<{ ok: true; values: FormValues<S> } | { ok: false; error: string }> {
  const blocked = aiFillBlocked();
  if (blocked) return { ok: false, error: blocked };

  const path = resolveImageUri(request.fileUri) ?? parseImageRef(request.fileUri).localUri ?? request.fileUri;
  let file: { mimeType: string; base64: string };
  try {
    const isPdf = /\.pdf$/i.test(path);
    const small = isPdf ? null : await shrinkPhoto(path);
    file = {
      mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
      base64: small ?? (await new File(path).base64()),
    };
  } catch {
    return { ok: false, error: 'The photo could not be read from this phone.' };
  }
  if ((file.base64.length * 3) / 4 > MAX_INLINE_BYTES) {
    return { ok: false, error: 'That file is too large. Try a photo instead.' };
  }

  const result = await generateAnalysisJson({
    task: 'extract',
    schema: schemaFor(request.form, request.documentKind),
    files: [file],
    systemInstruction: formInstruction(request),
    prompt: [request.context, 'Fill in the form from the attached file.'].filter(Boolean).join('\n\n'),
    onLog: request.onLog,
  });
  if (!result.ok) return result;

  const { matches, values } = readForm(request.form, result.data);
  if (!matches) {
    return { ok: false, error: `That does not look like ${request.documentKind}. Try another photo.` };
  }
  return { ok: true, values };
}

/**
 * Fill a form from what the model knows — no file. For questions such as
 * "what does this model's owner's manual say", where the answer is general
 * knowledge rather than something on a page. Thinks a little more than a read.
 */
export async function aiAnswerForm<S extends FormSpec>(request: {
  form: S;
  purpose: string;
  rules?: readonly string[];
  context: string;
  onLog?: (line: string) => void;
  live?: AiLive;
}): Promise<{ ok: true; values: FormValues<S> } | { ok: false; error: string }> {
  const blocked = aiFillBlocked();
  if (blocked) return { ok: false, error: blocked };
  return live(request.live, async () => {
    const result = await generateAnalysisJson({
      task: 'explain',
      schema: schemaFor(request.form),
      files: [],
      systemInstruction: knowledgeInstruction(request),
      prompt: request.context,
      onLog: request.onLog,
    });
    if (!result.ok) return result;
    return { ok: true as const, values: readForm(request.form, result.data).values };
  });
}
