/**
 * When the app should ask to be unlocked.
 *
 * The lock used to re-arm on every trip to the background, which meant glancing
 * at a notification, copying a figure from another app, or answering a message
 * cost a Face ID prompt each time. That is the behaviour the user reported as
 * "prompted too frequently": the check stopped reading as security and started
 * reading as friction, which is how people end up turning a lock off entirely.
 *
 * The rule here is the one every banking app settles on — lock on a *cold start*
 * and after a *meaningful* absence, not on every blur:
 *
 *   - first launch of the process: always locked;
 *   - returned within the grace period: stay unlocked;
 *   - away longer than the grace period: lock;
 *   - an explicit re-lock (erasing data, the user's own request): lock.
 *
 * Pure and clock-injected so every boundary is testable without waiting.
 */

/**
 * How long the app may sit in the background before it re-locks.
 *
 * Five minutes is the figure the user asked for, and it is the right order of
 * magnitude: long enough to cover checking a bank SMS, a calculator, or a
 * message and coming back, short enough that a phone left on a table is not
 * left open indefinitely.
 */
export const IDLE_LOCK_MS = 5 * 60 * 1000;

/** What the gate knows about the current session. */
export interface LockState {
  /** Whether App Lock is switched on at all. */
  enabled: boolean;
  /** True once the user has satisfied the lock in this session. */
  unlocked: boolean;
  /**
   * When the app last went to the background, or null if it has not since the
   * last unlock. Null while in the foreground is the normal resting state.
   */
  backgroundedAt: number | null;
}

/**
 * Whether the lock screen should be showing right now.
 *
 * Deliberately not "should we prompt": presenting the gate and firing the
 * biometric prompt are separate decisions, because the gate must also be up
 * while the user is typing a PIN or has dismissed a prompt.
 */
export function isLocked(state: LockState): boolean {
  if (!state.enabled) return false;
  return !state.unlocked;
}

/**
 * Whether returning to the foreground should re-lock the app.
 *
 * `backgroundedAt` of null means the app never actually left (iOS fires
 * `inactive` for the app switcher, a notification banner, and — critically —
 * for the biometric prompt itself; treating those as an absence is what created
 * the prompt loop this function exists to avoid).
 */
export function shouldRelockOnResume(
  backgroundedAt: number | null,
  now: number,
  idleMs: number = IDLE_LOCK_MS,
): boolean {
  if (backgroundedAt === null) return false;
  // A clock that moved backwards (manual time change, NTP correction) must fail
  // safe: treat it as an absence rather than as "no time has passed".
  if (now < backgroundedAt) return true;
  return now - backgroundedAt >= idleMs;
}

/**
 * Whether an AppState transition should be recorded as the user leaving.
 *
 * The subtlety this exists for: on iOS the system biometric sheet **backgrounds
 * the app**. Recording that as an absence means a Face ID prompt left sitting
 * longer than the idle window re-locks the app *underneath* the authentication
 * that is about to succeed — the user passes Face ID and lands on the lock
 * screen anyway. Neither half of the prompt's own background/active pair may
 * count, so the gate suppresses tracking entirely while a prompt is in flight.
 *
 * Separate from `shouldRelockOnResume` because they answer different questions:
 * this one is "did the user actually leave", that one is "were they gone long
 * enough". Both must be true to re-lock.
 */
export function shouldTrackAbsence(promptInFlight: boolean): boolean {
  return !promptInFlight;
}

/**
 * How long is left before the app re-locks, in ms. Zero once it is due.
 * Exposed for the settings copy so the timeout can be stated rather than
 * discovered.
 */
export function msUntilRelock(
  backgroundedAt: number | null,
  now: number,
  idleMs: number = IDLE_LOCK_MS,
): number {
  if (backgroundedAt === null) return idleMs;
  return Math.max(0, idleMs - (now - backgroundedAt));
}

/** Human wording for the grace period, for settings copy. */
export function describeIdleTimeout(idleMs: number = IDLE_LOCK_MS): string {
  const minutes = Math.round(idleMs / 60_000);
  if (minutes < 1) return 'immediately';
  return `after ${minutes} minute${minutes === 1 ? '' : 's'}`;
}
