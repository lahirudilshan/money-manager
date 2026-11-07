/**
 * How far along a lab-report analysis is, as one 0–1 number for the bar.
 *
 * Counted for real: files saved, pages prepared, Gemini's answer as it streams
 * in (each finished report title and test result moves the bar), and results
 * saved. The one stretch that cannot be counted is Gemini looking at the pages
 * before it writes its first word — nothing comes back during it. That
 * stretch alone is a time estimate from the page count, eased so it slows
 * down and stops well short of its end: the bar only moves on when the answer
 * actually starts arriving.
 *
 * Pure — tested in analyseProgress.test.ts.
 */

export type AnalyseStage =
  | 'saving-files'
  | 'reading'
  | 'thinking'
  | 'writing'
  | 'saving'
  /** Step 2: the numbers are saved and on screen; the plain words are coming. */
  | 'explaining';

/** Each stage's share of the bar, start → end. The AI read is most of it. */
const SPAN: Record<AnalyseStage, [number, number]> = {
  'saving-files': [0, 0.04],
  reading: [0.04, 0.1],
  /** Gemini looking at the pages — no output yet, so timed. */
  thinking: [0.1, 0.45],
  /** Gemini writing — moved by each finished item in the answer. */
  writing: [0.45, 0.75],
  saving: [0.75, 0.8],
  /** The explanation call — text only, timed from the result count. */
  explaining: [0.8, 1],
};

/** Roughly how long Gemini looks before it starts writing, in seconds. */
export function expectedReadSeconds(pages: number): number {
  return 8 + 4 * Math.max(1, pages);
}

/** Roughly how long the plain-words call takes for this many results. */
export function expectedExplainSeconds(results: number): number {
  return 6 + 0.5 * Math.max(1, results);
}

/** 1 − e^(−t/τ), τ set so the expected time lands at about 90 %; never full. */
function eased(seconds: number, expected: number): number {
  return Math.min(0.95, 1 - Math.exp(-seconds / (expected / 2.3)));
}

export function analyseProgress(input: {
  stage: AnalyseStage;
  /** Items finished in this stage, when the stage counts items. */
  done?: number;
  total?: number;
  /** Seconds since the AI read started. */
  thinkingSeconds?: number;
  /** Items Gemini has finished writing so far (reports + results). */
  written?: number;
  pages: number;
  /** Seconds since the explanation call started. */
  explainSeconds?: number;
  /** Results being explained. */
  results?: number;
}): number {
  const [start, end] = SPAN[input.stage];
  let within: number;
  if (input.stage === 'thinking') {
    within = eased(input.thinkingSeconds ?? 0, expectedReadSeconds(input.pages));
  } else if (input.stage === 'explaining') {
    within = eased(input.explainSeconds ?? 0, expectedExplainSeconds(input.results ?? 10));
  } else if (input.stage === 'writing') {
    // The total is not known until the answer ends, so each finished item
    // closes a share of the distance left — always forward, never complete.
    within = 1 - Math.pow(0.9, input.written ?? 0);
  } else if (input.total && input.total > 0) {
    within = Math.min(1, (input.done ?? 0) / input.total);
  } else {
    within = 0;
  }
  return start + (end - start) * within;
}

/** "0:07", "1:12". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------------ */
/* Reading Gemini's answer while it is still being written.                 */
/* ------------------------------------------------------------------------ */

export interface PartialAnalysis {
  /** The headline, once Gemini has finished writing it. */
  headline: string | null;
  /** Report titles finished so far. */
  reports: string[];
  /** Test names finished so far, in order. */
  results: string[];
}

/** A finished JSON string value for `key` — the closing quote must be there. */
function finishedStrings(text: string, key: string): string[] {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const out: string[] = [];
  for (const match of text.matchAll(pattern)) {
    try {
      out.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      out.push(match[1] ?? '');
    }
  }
  return out;
}

/**
 * What can be read from a half-written answer.
 *
 * The answer is JSON in the schema's order — headline and summary first, then
 * `reports`, then `results` — so this only has to find finished string values.
 * A value still being written has no closing quote yet and is not counted.
 * `title` is looked for only after `"reports"` begins, since nothing earlier
 * has that key.
 */
export function readPartialAnalysis(text: string): PartialAnalysis {
  const headline = finishedStrings(text, 'headline')[0] ?? null;
  const reportsAt = text.indexOf('"reports"');
  const resultsAt = text.indexOf('"results"');
  const reportsPart =
    reportsAt < 0 ? '' : text.slice(reportsAt, resultsAt > reportsAt ? resultsAt : undefined);
  return {
    headline,
    reports: finishedStrings(reportsPart, 'title'),
    results: resultsAt < 0 ? [] : finishedStrings(text.slice(resultsAt), 'testName'),
  };
}

/* ------------------------------------------------------------------------ */
/* The Lock Screen card while the phone is locked.                          */
/* ------------------------------------------------------------------------ */

/**
 * What the system Live Activity says: iOS draws it, so all there is to work
 * with is a title, a subtitle and the bar. The title says WHOSE reports; the
 * subtitle says what is happening now in words that mean something — pages,
 * results found, time left — and never a model name.
 */
export interface LockScreenText {
  title: string;
  subtitle: string;
}

export function lockScreenText(input: {
  personName: string;
  stage: AnalyseStage;
  /** The latest short status from the analysis ("12 results found · HbA1c"). */
  status: string | null;
  pages: number;
  thinkingSeconds: number;
  /** Seconds since the run started — shown so a long wait reads as work. */
  elapsedSeconds?: number;
}): LockScreenText {
  const clock = input.elapsedSeconds !== undefined ? ` · ${formatElapsed(input.elapsedSeconds)}` : '';
  const explaining = input.stage === 'explaining';
  // Title: whose, which of the two steps, and how long so far.
  const title = explaining
    ? `${possessive(input.personName)} results · step 2 of 2${clock}`
    : `${possessive(input.personName)} reports · step 1 of 2${clock}`;
  const pages = `${input.pages} ${input.pages === 1 ? 'page' : 'pages'}`;
  if (input.stage === 'thinking') {
    const expected = expectedReadSeconds(input.pages);
    const left = expected - input.thinkingSeconds;
    return {
      title,
      subtitle:
        left > 5
          ? `Gemini is reading ${pages} · about ${Math.ceil(left / 5) * 5}s left`
          : input.thinkingSeconds > expected * 1.5
            ? `Gemini is reading ${pages} · longer than usual, still working`
            : `Gemini is reading ${pages} · almost there`,
    };
  }
  const fallback: Record<AnalyseStage, string> = {
    'saving-files': `Saving ${pages}`,
    reading: `Preparing ${pages}`,
    thinking: `Gemini is reading ${pages}`,
    writing: 'Copying the results',
    saving: 'Saving to the health record',
    explaining: 'Results saved · writing them in simple words',
  };
  return { title, subtitle: input.status ?? fallback[input.stage] };
}

/** The card's last words — it stays briefly after the job ends. */
export function lockScreenDone(input: {
  personName: string;
  results: number;
  flagged: number;
  elapsedSeconds?: number;
}): LockScreenText {
  const results = `${input.results} ${input.results === 1 ? 'result' : 'results'}`;
  const took = input.elapsedSeconds !== undefined ? ` in ${formatElapsed(input.elapsedSeconds)}` : '';
  return {
    title: `${possessive(input.personName)} reports are ready${took}`,
    subtitle:
      input.flagged > 0
        ? `${results} · ${input.flagged} ${input.flagged === 1 ? 'needs' : 'need'} a look`
        : `${results} · all in the normal range`,
  };
}

export function lockScreenFailed(input: { personName: string; error: string }): LockScreenText {
  // The first sentence is the useful part; the card has one line.
  const first = input.error.split(/(?<=\.)\s/)[0] ?? input.error;
  return { title: `Couldn’t finish ${possessive(input.personName)} reports`, subtitle: first };
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}
