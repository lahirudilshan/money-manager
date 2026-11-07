/**
 * Keep a job the user just started running when the app leaves the screen,
 * with its progress shown by iOS on the Lock Screen.
 *
 * Without this, iOS suspends the app a few seconds after the phone is locked
 * or another app is opened, and a long job — a lab-report analysis waiting on
 * Gemini — freezes mid-request until the app is opened again. iOS 26's
 * continued-processing task (modules/background-work) keeps the app running
 * and draws the system Live Activity from the title, subtitle and progress
 * reported here.
 *
 * Everywhere it cannot run — below iOS 26, Android, a build made before the
 * native module existed, or the system declining — `start` still returns a
 * job whose calls do nothing: the work runs exactly as it did before, only
 * while the app is on screen.
 *
 * The system expires a task whose bar stops moving. The native module nudges
 * it forward when nothing else has, but keep calling `update` with the real
 * progress for as long as the job runs.
 */
// Outside src/, so no `~/` alias — same exception as assets.
import BackgroundWork from '../../../modules/background-work';

export interface BackgroundJob {
  /** Whether iOS agreed to keep the app running for this job. */
  readonly kept: boolean;
  /** `fraction` is 0–1. Cheap to call every second. */
  update(input: { title: string; subtitle: string; fraction: number }): void;
  finish(success: boolean): void;
}

/** Fine enough that the native heartbeat's one-unit nudge is invisible. */
const STEPS = 10_000;

export function startBackgroundJob(input: {
  title: string;
  subtitle: string;
  /** iOS ended the job early (the user stopped it, or the system needed the resources). */
  onExpire?: () => void;
}): BackgroundJob {
  const module = BackgroundWork;
  if (!module || !module.isSupported()) return idleJob;

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let kept = false;
  try {
    kept = module.start(suffix, input.title, input.subtitle);
  } catch {
    kept = false;
  }
  if (!kept) return idleJob;

  let done = false;
  const subscription = module.addListener('onExpire', () => {
    if (done) return;
    done = true;
    subscription.remove();
    input.onExpire?.();
  });

  return {
    kept: true,
    update({ title, subtitle, fraction }) {
      if (done) return;
      const clamped = Math.min(1, Math.max(0, fraction));
      module.update(title, subtitle, Math.round(clamped * STEPS), STEPS);
    },
    finish(success) {
      if (done) return;
      done = true;
      subscription.remove();
      module.finish(success);
    },
  };
}

const idleJob: BackgroundJob = {
  kept: false,
  update() {},
  finish() {},
};
