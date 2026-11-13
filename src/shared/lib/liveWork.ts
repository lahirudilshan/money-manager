/**
 * Run a job the user started so it survives leaving the screen — and say when
 * it is done.
 *
 * Wraps `startBackgroundJob` (iOS 26 keeps the app running and draws a Live
 * Activity on the Lock Screen / Dynamic Island) with the two things every
 * caller needs and kept re-writing:
 *
 *   - PROGRESS for a job that reports none of its own. An AI read is one long
 *     request; the bar follows the expected duration and slows as it nears
 *     the end, never reaching it — only finishing completes it. Ticked every
 *     second, because iOS ends a task whose bar stops moving.
 *   - A NOTIFICATION when it ends while the user is elsewhere (another app,
 *     phone locked). On screen, the result is already in front of them, so
 *     nothing is sent.
 *
 * Below iOS 26 / on Android the job simply runs while the app is open, as
 * before; the notification still fires if it finishes in the few seconds
 * before the app is suspended.
 */

import { AppState } from 'react-native';
import { startBackgroundJob } from './backgroundWork';
import { notifyWorkDone } from './notifications';

export interface LiveWorkMessage {
  title: string;
  body: string;
  route?: string;
}

/** 0 → ~0.95 over the expected time, easing off; pure for testing. */
export function estimatedFraction(elapsedSeconds: number, expectedSeconds: number): number {
  if (expectedSeconds <= 0) return 0;
  return Math.min(0.95, 1 - Math.exp(-elapsedSeconds / expectedSeconds) * 1);
}

export async function withLiveWork<T>(
  options: {
    /** Lock Screen title, e.g. "Reading your invoice". */
    title: string;
    /** Lock Screen subtitle while it runs. */
    subtitle: string;
    /** How long it usually takes — shapes the progress bar. */
    expectedSeconds: number;
    /** What to say when it finishes off-screen; null to stay quiet. */
    done: (result: T) => LiveWorkMessage | null;
    /** What to say when it throws off-screen. */
    failed?: LiveWorkMessage;
  },
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const job = startBackgroundJob({ title: options.title, subtitle: options.subtitle });
  const tick = () =>
    job.update({
      title: options.title,
      subtitle: options.subtitle,
      fraction: estimatedFraction((Date.now() - startedAt) / 1000, options.expectedSeconds),
    });
  tick();
  const ticker = job.kept ? setInterval(tick, 1_000) : null;
  const away = () => AppState.currentState !== 'active';

  try {
    const result = await work();
    job.finish(true);
    if (away()) {
      const message = options.done(result);
      if (message) void notifyWorkDone(message);
    }
    return result;
  } catch (error) {
    job.finish(false);
    if (away() && options.failed) void notifyWorkDone(options.failed);
    throw error;
  } finally {
    if (ticker) clearInterval(ticker);
  }
}
