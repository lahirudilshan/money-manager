import { useSyncExternalStore } from 'react';
import type { AnalyseRunState } from '~/features/health/components/AnalyseProgressCard';

/**
 * The AI reading in flight, held outside the Analyse screen.
 *
 * Leaving mid-reading is allowed — the read carries on — but the progress
 * lived in that screen's state, so it vanished with the screen and the result
 * landed silently. Kept here, the Health home, Documents and Labs show the
 * same run where the AI's results appear, and its outcome until it is seen.
 *
 * One run at a time: the Analyse screen will not start a second while one is
 * going.
 */

export type AnalyseOutcome =
  | { ok: true; analysisId: string; results: number; flagged: number }
  | { ok: false; error: string };

export interface ActiveAnalyseRun {
  personId: string;
  personName: string;
  documentIds: string[];
  run: AnalyseRunState;
  /** Set once the numbers are saved, while the explanation is still coming. */
  analysisId?: string;
  /** Set when the reading ends; the run stays until dismissed or opened. */
  outcome: AnalyseOutcome | null;
}

let current: ActiveAnalyseRun | null = null;
const listeners = new Set<() => void>();

function emit(next: ActiveAnalyseRun | null) {
  current = next;
  for (const listener of listeners) listener();
}

export function beginAnalyseRun(run: Omit<ActiveAnalyseRun, 'outcome'>): void {
  emit({ ...run, outcome: null });
}

export function updateAnalyseRun(
  change: (run: ActiveAnalyseRun) => Partial<ActiveAnalyseRun>,
): void {
  if (current) emit({ ...current, ...change(current) });
}

export function finishAnalyseRun(outcome: AnalyseOutcome): void {
  if (current) emit({ ...current, outcome });
}

export function dismissAnalyseRun(): void {
  if (current) emit(null);
}

export function activeAnalyseRun(): ActiveAnalyseRun | null {
  return current;
}

/** Whether this analysis's plain-words explanation is still being written. */
export function useIsExplaining(analysisId: string | undefined): boolean {
  const run = useActiveAnalyseRun();
  return Boolean(analysisId && run && !run.outcome && run.analysisId === analysisId);
}

export function isAnalyseRunning(): boolean {
  return current !== null && current.outcome === null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The run in flight (or just ended), optionally only when it is this person's. */
export function useActiveAnalyseRun(personId?: string | null): ActiveAnalyseRun | null {
  const run = useSyncExternalStore(subscribe, activeAnalyseRun, activeAnalyseRun);
  if (!run) return null;
  if (personId !== undefined && run.personId !== personId) return null;
  return run;
}
