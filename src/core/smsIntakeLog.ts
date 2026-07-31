/**
 * A tiny in-memory record of what happened to each incoming SMS deep link.
 *
 * The intake pipeline has several places where a message can legitimately stop —
 * the URL carried no `text`, the parser did not recognise it as a money
 * movement — and every one of them is silent by design. From the outside all of
 * them look identical: "the Shortcut opened the app but no draft appeared."
 * That is the single hardest thing to debug about this feature, because the
 * failure is invisible and the message that caused it is already gone.
 *
 * This keeps the last few outcomes so the SMS setup screen can show them. It is
 * deliberately in-memory only: these are transient diagnostics, not user data,
 * and they routinely contain full bank messages with balances in them — writing
 * that to disk would be storing exactly what this app is careful not to store.
 */

/** What became of one delivered URL. */
export type SmsIntakeOutcome =
  /** Parsed and queued as a draft — the happy path. */
  | 'ingested'
  /** Decoded fine, but `parseSms` did not see a money movement in it. */
  | 'parser-rejected'
  /** The URL reached the app with no usable `text=` parameter. */
  | 'no-text-param'
  /**
   * Already queued, so this delivery was ignored.
   *
   * Not a failure: BOTH the root layout's URL listener and the `sms/index`
   * route ingest a cold-start link, and the store's raw-text dedupe drops the
   * second. Reporting that as `parser-rejected` made every successful deep link
   * show a spurious error right underneath its own success.
   */
  | 'duplicate'
  /**
   * The link arrived cut short. Verified cause: the Shortcut has no **URL
   * Encode** action, so iOS truncated the URL at the first space in the
   * message. A setup problem, not a parsing one.
   */
  | 'truncated';

export interface SmsIntakeEntry {
  outcome: SmsIntakeOutcome;
  /** The decoded message (or the raw URL, when there was no text to decode). */
  text: string;
  at: number;
}

/** How many to keep. Enough to see a pattern, small enough to stay a debug aid. */
const MAX_ENTRIES = 10;

let entries: SmsIntakeEntry[] = [];
const listeners = new Set<() => void>();

/** Record an intake outcome. Newest first. */
export function logSmsIntake(outcome: SmsIntakeOutcome, text: string): void {
  entries = [{ outcome, text, at: Date.now() }, ...entries].slice(0, MAX_ENTRIES);
  for (const listener of listeners) listener();
}

/** The recorded outcomes, newest first. */
export function getSmsIntakeLog(): readonly SmsIntakeEntry[] {
  return entries;
}

/** Forget everything — the "clear" action on the diagnostics panel. */
export function clearSmsIntakeLog(): void {
  entries = [];
  for (const listener of listeners) listener();
}

/** Subscribe to changes; returns an unsubscribe. Drives the live panel. */
export function subscribeSmsIntakeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One-line explanation of an outcome, for the diagnostics panel. */
export function describeOutcome(outcome: SmsIntakeOutcome): string {
  switch (outcome) {
    case 'ingested':
      return 'Draft created';
    case 'parser-rejected':
      return 'Opened, but not read as a payment';
    case 'duplicate':
      return 'Already added';
    case 'truncated':
      return 'Link cut short — add URL Encode to the Shortcut';
    case 'no-text-param':
      return 'Link had no message in it';
  }
}
