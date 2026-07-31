import { describe, expect, it } from 'vitest';
import {
  IDLE_LOCK_MS,
  describeIdleTimeout,
  isLocked,
  msUntilRelock,
  shouldRelockOnResume,
  shouldTrackAbsence,
} from '../lockPolicy';

describe('isLocked', () => {
  it('is never locked when App Lock is off', () => {
    expect(isLocked({ enabled: false, unlocked: false, backgroundedAt: null })).toBe(false);
  });

  it('is locked when enabled and not yet unlocked — the cold-start case', () => {
    expect(isLocked({ enabled: true, unlocked: false, backgroundedAt: null })).toBe(true);
  });

  it('is unlocked once the user has satisfied the lock', () => {
    expect(isLocked({ enabled: true, unlocked: true, backgroundedAt: null })).toBe(false);
  });
});

describe('shouldRelockOnResume', () => {
  const T = 1_000_000_000_000;

  it('does not re-lock when the app never actually backgrounded', () => {
    // iOS fires `inactive` for the app switcher, notification banners and the
    // biometric prompt itself. Treating those as an absence caused the prompt
    // loop this guards against.
    expect(shouldRelockOnResume(null, T)).toBe(false);
  });

  it('does not re-lock on a brief absence', () => {
    // Glancing at the bank SMS that triggered a draft, then coming straight back.
    expect(shouldRelockOnResume(T, T + 30_000)).toBe(false);
  });

  it('does not re-lock just under the grace period', () => {
    expect(shouldRelockOnResume(T, T + IDLE_LOCK_MS - 1)).toBe(false);
  });

  it('re-locks exactly at the grace period', () => {
    expect(shouldRelockOnResume(T, T + IDLE_LOCK_MS)).toBe(true);
  });

  it('re-locks after a long absence', () => {
    expect(shouldRelockOnResume(T, T + 60 * 60_000)).toBe(true);
  });

  it('fails safe when the clock moved backwards', () => {
    // A manual time change must not be usable to hold the lock open.
    expect(shouldRelockOnResume(T, T - 60_000)).toBe(true);
  });

  it('honours a custom idle window', () => {
    expect(shouldRelockOnResume(T, T + 45_000, 30_000)).toBe(true);
    expect(shouldRelockOnResume(T, T + 15_000, 30_000)).toBe(false);
  });

  it('re-locks immediately with a zero window', () => {
    expect(shouldRelockOnResume(T, T, 0)).toBe(true);
  });
});

describe('shouldTrackAbsence', () => {
  it('tracks a normal background as a real absence', () => {
    expect(shouldTrackAbsence(false)).toBe(true);
  });

  it('ignores the background caused by the biometric prompt itself', () => {
    expect(shouldTrackAbsence(true)).toBe(false);
  });
});

/**
 * The two functions composed, which is what the gate actually does. Written as
 * scenarios because the bug they guard was only visible in the sequence: a Face
 * ID sheet left sitting past the idle window re-locked the app underneath a
 * successful authentication.
 */
describe('lock decisions in sequence', () => {
  const T = 1_000_000_000_000;

  /** Returns whether the app re-locks on resume, given how the absence began. */
  function resumeAfter(opts: {
    promptInFlight: boolean;
    awayMs: number;
  }): boolean {
    let backgroundedAt: number | null = null;
    // Background event.
    if (shouldTrackAbsence(opts.promptInFlight)) backgroundedAt = T;
    // Active event.
    if (!shouldTrackAbsence(opts.promptInFlight)) return false;
    return shouldRelockOnResume(backgroundedAt, T + opts.awayMs);
  }

  it('does not re-lock after a slow Face ID prompt', () => {
    // The exact bug: user takes 6 minutes to authenticate (or the sheet sits
    // while they are interrupted). The app must NOT be locked behind them.
    expect(resumeAfter({ promptInFlight: true, awayMs: 6 * 60_000 })).toBe(false);
  });

  it('does not re-lock after a quick Face ID prompt', () => {
    expect(resumeAfter({ promptInFlight: true, awayMs: 2_000 })).toBe(false);
  });

  it('still re-locks after a genuine long absence', () => {
    // The protection must not swallow the real case.
    expect(resumeAfter({ promptInFlight: false, awayMs: 6 * 60_000 })).toBe(true);
  });

  it('does not re-lock after a genuine brief absence', () => {
    expect(resumeAfter({ promptInFlight: false, awayMs: 30_000 })).toBe(false);
  });
});

describe('msUntilRelock', () => {
  const T = 1_000_000_000_000;

  it('reports the full window while in the foreground', () => {
    expect(msUntilRelock(null, T)).toBe(IDLE_LOCK_MS);
  });

  it('counts down while backgrounded', () => {
    expect(msUntilRelock(T, T + 60_000)).toBe(IDLE_LOCK_MS - 60_000);
  });

  it('is zero once the window has passed', () => {
    expect(msUntilRelock(T, T + IDLE_LOCK_MS + 5_000)).toBe(0);
  });
});

describe('describeIdleTimeout', () => {
  it('describes the default window', () => {
    expect(describeIdleTimeout()).toBe('after 5 minutes');
  });

  it('uses the singular for one minute', () => {
    expect(describeIdleTimeout(60_000)).toBe('after 1 minute');
  });

  it('says "immediately" for a zero window', () => {
    expect(describeIdleTimeout(0)).toBe('immediately');
  });
});
