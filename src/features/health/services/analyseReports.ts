import { File } from 'expo-file-system';
import { healthDocumentRepo, healthLabRepo } from '~/db/repositories';
import type { HealthPerson } from '~/db/schema';
import { MAX_INLINE_BYTES } from '~/features/health/logic/gemini';
import { mergeTags, tagsFromResults } from '~/features/health/logic/documentSearch';
import { readPartialAnalysis } from '~/features/health/logic/analyseProgress';
import {
  buildExplanationPrompt,
  buildExtractionPrompt,
  documentTitles,
  EXPLANATION_INSTRUCTION,
  EXTRACTION_INSTRUCTION,
  mergeExplanation,
  combineExtractions,
  parseExtraction,
  reportDateFor,
  unexplainedKeys,
} from '~/features/health/logic/labReports';
import { parseImageRef } from '~/shared/lib/imageRef';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { analysesLeftToday, isAiEnabled } from './aiSettings';
import {
  generateAnalysisJson,
  isAiAvailable,
  usesOwnGoogleAi,
  type InlineFile,
} from './firebaseAi';
import { userGeminiKey } from './userGemini';

/**
 * Read a batch of saved report documents with AI, and store what came back.
 *
 * Takes DOCUMENT ids, not files: the documents are saved before this runs, so
 * a failed or interrupted analysis never loses a report the user just
 * photographed — it can simply be run again on the same documents.
 */

export type AnalyseStep = 'reading' | 'thinking' | 'writing' | 'saving' | 'explaining';

/**
 * What the screen hears while an analysis runs: the stage, how far through
 * it (when it counts items), and an optional plain-words log line.
 */
export interface AnalyseProgressEvent {
  step: AnalyseStep;
  done?: number;
  total?: number;
  log?: string;
  /**
   * A short line for the Lock Screen while the phone is locked ("12 results
   * found · HbA1c"). Kept until the next event that carries one.
   */
  status?: string;
}

export async function analyseDocuments(input: {
  person: HealthPerson;
  documentIds: readonly string[];
  onProgress?: (event: AnalyseProgressEvent) => void;
  /** The documents were renamed — reload so the list shows the new names now. */
  onRenamed?: () => void;
  /**
   * The numbers are saved and can be shown — the explanation is still being
   * written and lands on the same analysis when it answers.
   */
  onSaved?: (saved: { analysisId: string; results: number; flagged: number }) => void;
}): Promise<
  | { ok: true; analysisId: string; results: number; flagged: number; explained: boolean }
  | { ok: false; error: string }
> {
  if (!isAiEnabled()) {
    return { ok: false, error: 'AI features are turned off. You can turn them on in Settings.' };
  }
  // Reads the keychain once, so the checks below see the user's own key.
  await userGeminiKey();
  if (!isAiAvailable()) {
    return { ok: false, error: 'AI reading is not available in this version of the app.' };
  }
  // The phone's daily cap protects Dayly's shared allowance; on the user's
  // own Google allowance, Google's own limit is the only one.
  if (!usesOwnGoogleAi() && analysesLeftToday() === 0) {
    return {
      ok: false,
      error: 'You have read the most reports allowed for today. Try again tomorrow.',
    };
  }

  const documents = healthDocumentRepo
    .byPerson(input.person.id)
    .filter((doc) => input.documentIds.includes(doc.id));
  // Keep the order the user added them in — fileIndex refers to it.
  documents.sort((a, b) => input.documentIds.indexOf(a.id) - input.documentIds.indexOf(b.id));
  if (documents.length === 0) return { ok: false, error: 'No reports to read.' };

  const report = input.onProgress ?? (() => undefined);
  report({
    step: 'reading',
    done: 0,
    total: documents.length,
    log: `Preparing ${documents.length} ${documents.length === 1 ? 'page' : 'pages'}`,
  });
  const files: InlineFile[] = [];
  let totalBytes = 0;
  for (const doc of documents) {
    const path = resolveImageUri(doc.imageUri) ?? parseImageRef(doc.imageUri).localUri;
    if (!path) {
      return {
        ok: false,
        error: `"${doc.title}" is not on this phone yet. Open it once so it downloads, then try again.`,
      };
    }
    try {
      const isPdf = /\.pdf$/i.test(path);
      const file = new File(path);
      // A phone photo is 3–5 MB; sent as is, the upload alone takes most of
      // the wait on mobile data. Gemini scales it down on arrival anyway.
      const small = isPdf ? null : await shrinkPhoto(path);
      const size = small ? Math.round((small.length * 3) / 4) : (file.size ?? 0);
      totalBytes += size;
      if (totalBytes > MAX_INLINE_BYTES) {
        return {
          ok: false,
          error: 'These files are too large to send together. Try fewer pages at a time.',
        };
      }
      files.push({
        mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
        base64: small ?? (await file.base64()),
      });
      report({
        step: 'reading',
        done: files.length,
        total: documents.length,
        status: `Preparing page ${Math.min(files.length + 1, documents.length)} of ${documents.length}`,
        log: `Page ${files.length} of ${documents.length} ready (${isPdf ? 'PDF' : 'photo'}, ${kb(size)}${small ? `, was ${kb(file.size ?? 0)}` : ''})`,
      });
    } catch {
      return { ok: false, error: `"${doc.title}" could not be read from this phone.` };
    }
  }

  const age = input.person.bornOn
    ? Math.floor((Date.now() - input.person.bornOn.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  // 1. EXTRACT: the pages in, only the numbers out. Files go in groups of
  // FILES_PER_CALL — a normal batch is ONE request — and groups run side by
  // side. Requests, not size, are what the free tier counts (20 a day for
  // Flash, measured 2026-11-07), and one call on a few small reports answers
  // in 5–9 s anyway, so a call per file only burned quota.
  report({ step: 'thinking', log: 'Asking Gemini' });
  const groups = chunk(files, FILES_PER_CALL);
  const seen = groups.map(() => ({ reports: 0, results: 0, latest: null as string | null }));
  let started = false;
  const readFile = (index: number) =>
    generateAnalysisJson({
      task: 'extract',
      files: groups[index],
      systemInstruction: EXTRACTION_INSTRUCTION,
      prompt: buildExtractionPrompt(groups[index].length),
      onLog: (line) =>
        report({
          step: started ? 'writing' : 'thinking',
          log: groups.length > 1 ? `Group ${index + 1}: ${line}` : line,
        }),
      // The answer as it is written: say each finished piece as it lands.
      onPartial: (text) => {
        const partial = readPartialAnalysis(text);
        const mine = seen[index];
        const lines: string[] = [];
        if (!started) {
          started = true;
          lines.push('Copying the results');
        }
        for (const title of partial.reports.slice(mine.reports)) lines.push(`Report: ${title}`);
        for (const name of partial.results.slice(mine.results)) lines.push(`Found ${name}`);
        mine.reports = partial.reports.length;
        mine.results = partial.results.length;
        mine.latest = partial.results[partial.results.length - 1] ?? mine.latest;
        const found = seen.reduce((sum, s) => sum + s.results, 0);
        const written = seen.reduce((sum, s) => sum + s.reports + s.results, 0);
        if (lines.length === 0) {
          report({ step: 'writing', done: written, total: found });
          return;
        }
        const status =
          found > 0
            ? `${found} ${found === 1 ? 'result' : 'results'} found${mine.latest ? ` · ${mine.latest}` : ''}`
            : 'Finding the results';
        for (const line of lines)
          report({ step: 'writing', done: written, total: found, log: line, status });
      },
    });
  const answers = await inBatches(groups.length, EXTRACT_PARALLEL, readFile);

  const firstFailure = answers.find((a) => !a.ok);
  const extraction = combineExtractions(
    answers.map((answer, index) => ({
      firstFile: index * FILES_PER_CALL,
      extraction: answer.ok ? parseExtraction(answer.data, groups[index].length) : null,
    })),
  );
  if (!extraction) {
    if (firstFailure && !firstFailure.ok) return firstFailure;
    return {
      ok: false,
      error: 'No test results were found. Make sure the photo shows the whole report clearly.',
    };
  }
  answers.forEach((answer, index) => {
    if (!answer.ok) {
      const from = index * FILES_PER_CALL + 1;
      const to = from + groups[index].length - 1;
      const which = from === to ? `File ${from}` : `Files ${from}–${to}`;
      report({ step: 'writing', log: `${which} could not be read: ${answer.error}` });
    }
  });
  const firstOk = answers.find((a) => a.ok);
  const extracted = { model: firstOk && firstOk.ok ? firstOk.model : 'gemini' };

  // Name the documents NOW, from the read alone: the explanation is a second
  // call that can fail, and the list should stop saying "Lab report" the
  // moment the paper has been read.
  const titles = documentTitles(extraction, documents.length);
  const firstDate = reportDateFor(extraction.reports, documents[0]?.documentDate ?? new Date());
  documents.forEach((doc, index) => {
    const report = extraction.reports.find((r) => r.fileIndex === index);
    healthDocumentRepo.update(doc.id, {
      title: titles[index],
      documentDate: report?.reportDate ?? firstDate,
      kind: 'report',
    });
  });
  for (const name of [...new Set(titles)]) report({ step: 'writing', log: `Named: ${name}` });
  input.onRenamed?.();

  // 2. SAVE THE NUMBERS NOW. They are what the user is waiting for, and the
  // explanation is a second round trip — showing nothing until it answered
  // doubled the wait. Words already known from earlier reports fill in now.
  const known = healthLabRepo.testWords(extraction.results.map((r) => r.testKey));
  const unexplained = unexplainedKeys(extraction.results, known);
  const numbers = mergeExplanation(extraction, null, known);
  const count = numbers.results.length;
  const resultsWord = `${count} ${count === 1 ? 'result' : 'results'}`;
  const flagged = numbers.results.filter(
    (r) => r.status === 'high' || r.status === 'low' || r.status === 'abnormal',
  ).length;
  report({
    step: 'saving',
    done: 0,
    total: count,
    status: `Saving ${resultsWord}`,
    log: `Found ${resultsWord} in ${numbers.reports.length} ${numbers.reports.length === 1 ? 'report' : 'reports'}`,
  });
  if (flagged > 0) report({ step: 'saving', done: 0, total: count, log: `${flagged} outside the normal range` });

  const now = new Date();
  const reportDate = reportDateFor(numbers.reports, documents[0]?.documentDate ?? now);
  const dateForFile = (index: number) =>
    numbers.reports.find((r) => r.fileIndex === index)?.reportDate ?? reportDate;
  tagDocuments(documents, numbers);

  const analysis = healthLabRepo.createAnalysis(
    {
      personId: input.person.id,
      documentIds: JSON.stringify(documents.map((d) => d.id)),
      headline: numbers.headline,
      summary: numbers.summary,
      overallJson: JSON.stringify(numbers.overall),
      model: extracted.model,
      reportDate,
      analysedAt: now,
    },
    numbers.results.map((result) => ({
      documentId: documents[result.fileIndex]?.id ?? null,
      testKey: result.testKey,
      testName: result.testName,
      category: result.category,
      value: result.value,
      valueText: result.valueText,
      unit: result.unit,
      refLow: result.refLow,
      refHigh: result.refHigh,
      refText: result.refText,
      status: result.status,
      ...wordsOf(result),
      measuredAt: dateForFile(result.fileIndex),
    })),
  );
  report({ step: 'saving', done: count, total: count, log: 'Results saved — opening them' });
  input.onSaved?.({ analysisId: analysis.id, results: count, flagged });

  // 3. EXPLAIN: no pages, just the results as text. Tests explained in an
  // earlier report are not explained again.
  report({
    step: 'explaining',
    done: 0,
    total: count,
    status: `${resultsWord} saved${flagged > 0 ? ` · ${flagged} to look at` : ''} · writing them in simple words`,
    log:
      unexplained.length > 0
        ? `Explaining ${resultsWord} (${unexplained.length} new ${unexplained.length === 1 ? 'test' : 'tests'})`
        : `Explaining ${resultsWord}`,
  });
  const explained = await generateAnalysisJson({
    task: 'explain',
    files: [],
    systemInstruction: EXPLANATION_INSTRUCTION,
    prompt: buildExplanationPrompt({
      person: { name: input.person.name, age, conditions: input.person.conditions },
      results: extraction.results,
      unexplained,
    }),
    onLog: (line) => report({ step: 'explaining', total: count, log: line }),
  });
  if (explained.ok) {
    const parsed = mergeExplanation(extraction, explained.data, known);
    healthLabRepo.applyExplanation(
      analysis.id,
      {
        headline: parsed.headline,
        summary: parsed.summary,
        overallJson: JSON.stringify(parsed.overall),
      },
      parsed.results.flatMap((result, index) => {
        const id = analysis.resultIds[index];
        return id ? [{ id, words: wordsOf(result) }] : [];
      }),
    );
    // Search terms arrive with the explanation; the tags pick them up.
    tagDocuments(documents, parsed);
    report({ step: 'explaining', done: count, total: count, log: 'Explanation added' });
  } else {
    // The numbers are already saved — they are the part that needed the pages.
    report({ step: 'explaining', total: count, log: `Saved the numbers without a summary: ${explained.error}` });
  }
  return { ok: true, analysisId: analysis.id, results: count, flagged, explained: explained.ok };
}

type Merged = ReturnType<typeof mergeExplanation>;

function wordsOf(result: Merged['results'][number]) {
  return {
    meaning: result.meaning,
    ifHigh: result.ifHigh,
    ifLow: result.ifLow,
    bodyArea: result.bodyArea,
    explanation: result.explanation,
    searchTerms: result.searchTerms,
  };
}

/**
 * Tags built from what was read off each document — the offline report search
 * matches on those. The lab's name goes in the tags, not the title, so
 * "asiri" still finds the report while the list stays short.
 */
function tagDocuments(
  documents: ReadonlyArray<{ id: string; tags: string | null }>,
  parsed: Merged,
): void {
  documents.forEach((doc, index) => {
    const own = parsed.results.filter((r) => r.fileIndex === index);
    const fromAi = tagsFromResults(own.length > 0 ? own : parsed.results);
    const lab = parsed.reports.find((r) => r.fileIndex === index)?.labName;
    const current = healthDocumentRepo.byId(doc.id)?.tags ?? doc.tags;
    healthDocumentRepo.update(doc.id, { tags: mergeTags(current, fromAi, lab) });
  });
}

/** Longest side sent to Gemini — small lab print stays sharp at this size. */
const PHOTO_MAX_SIDE = 2048;

/**
 * The photo re-encoded at most PHOTO_MAX_SIDE on its longer side, as base64,
 * or null to send the original (a build without the native module, or any
 * failure — the original always works, only slower).
 */
async function shrinkPhoto(path: string): Promise<string | null> {
  // Probe before requiring: a missing native module throws at import time,
  // outside any try/catch here (see googleDrive.ts).
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  if (!registry?.ExpoImageManipulator) return null;
  try {
    const { ImageManipulator, SaveFormat } =
      require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const uri = path.startsWith('/') ? `file://${path}` : path;
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(original.width, original.height);
    const image =
      longest > PHOTO_MAX_SIDE
        ? await ImageManipulator.manipulate(original)
            .resize(
              original.width >= original.height
                ? { width: PHOTO_MAX_SIDE, height: null }
                : { width: null, height: PHOTO_MAX_SIDE },
            )
            .renderAsync()
        : original;
    const saved = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG, base64: true });
    return saved.base64 ?? null;
  } catch {
    return null;
  }
}

/** Files per extraction request — a typical batch is one request. */
const FILES_PER_CALL = 6;
/** Requests at once, for batches bigger than one group. */
const EXTRACT_PARALLEL = 2;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `run(0…count-1)`, at most `limit` at a time, answers in index order. */
async function inBatches<T>(
  count: number,
  limit: number,
  run: (index: number) => Promise<T>,
): Promise<T[]> {
  const out = new Array<T>(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next++;
      out[index] = await run(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return out;
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
