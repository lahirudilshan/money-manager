/**
 * The drop-file bridge between the Shortcuts app and this one.
 *
 * iOS will not let an app read SMS. The existing workaround is a deep link per
 * message, which forces the app to the foreground every single time — fine for
 * the occasional alert, hostile when a bank sends five in a row.
 *
 * This is the quieter path: a Shortcuts automation APPENDS each matching
 * message to a plain text file in this app's Documents folder, and the app
 * drains that file the next time it is opened. Nothing interrupts the user,
 * messages queue up while the app is closed, and Shortcuts needs no permission
 * beyond writing a file it created.
 *
 * The format is deliberately the dumbest thing that works, because the other
 * end is authored by a user dragging blocks around in Shortcuts:
 *
 *   - one message per record
 *   - records separated by a line containing only `---`
 *   - anything else is message text, newlines and all
 *
 * No JSON, no escaping, no quoting. A user cannot get it subtly wrong, and a
 * bank message containing a comma, quote or newline needs no special handling.
 *
 * Everything here is pure string work so it is fully testable without a device,
 * a file system, or Shortcuts.
 */

/** The line that separates two messages. Must be the whole line. */
export const RECORD_SEPARATOR = '---';

/** The file Shortcuts appends to. */
export const INBOX_FILENAME = 'sms-inbox.txt';

/**
 * The folder that file lives in, inside the app's Documents.
 *
 * A named subfolder rather than Documents' root: in Shortcuts the user picks a
 * folder and then types a path relative to it, and "money-manager/sms-inbox.txt"
 * is something they can read back and confirm they got right. It also keeps the
 * app's own SQLite directory out of view when they browse there in Files.
 */
export const INBOX_FOLDER = 'money-manager';

/** What the user types into Shortcuts' File Path field. */
export const INBOX_RELATIVE_PATH = `${INBOX_FOLDER}/${INBOX_FILENAME}`;

/**
 * A cap on how many messages one drain will process.
 *
 * A runaway automation — a Shortcuts loop, or a user testing with their whole
 * message history — could otherwise leave a file with thousands of entries that
 * blocks the UI on open. The remainder is kept in the file and picked up on the
 * next drain, so nothing is lost.
 */
export const MAX_MESSAGES_PER_DRAIN = 50;

/**
 * Split the inbox file into individual messages.
 *
 * Tolerant on purpose, because every quirk below is something a real Shortcuts
 * action does:
 *
 *   - Windows line endings, since some actions emit CRLF;
 *   - a leading or trailing separator, from an automation that writes one
 *     before every message rather than between them;
 *   - blank records, from a double separator or a stray newline;
 *   - surrounding whitespace on each message.
 *
 * Returns messages in file order, which is arrival order.
 */
export function parseInbox(contents: string): string[] {
  if (!contents) return [];

  return contents
    .replace(/\r\n/g, '\n')
    .split(/^---\s*$/m)
    .map((record) => record.trim())
    .filter((record) => record.length > 0);
}

/** The outcome of draining the inbox, for the UI to report. */
export interface DrainPlan {
  /** Messages to hand to the parser, oldest first, capped. */
  messages: string[];
  /**
   * What must be written back to the file afterwards.
   *
   * Empty string when everything was taken — the caller deletes the file rather
   * than leaving an empty one, so a user browsing Files sees it disappear when
   * the queue is clear.
   */
  remainder: string;
  /** Messages left for the next drain because of the cap. */
  deferred: number;
}

/**
 * Decide what to take from the inbox and what to leave.
 *
 * Separated from the file I/O so the cap and the write-back can be tested
 * exactly, including the case that matters most: the remainder must be
 * re-serialised in a form `parseInbox` reads back identically, or a capped
 * drain would corrupt the queue it just wrote.
 */
export function planDrain(contents: string, limit = MAX_MESSAGES_PER_DRAIN): DrainPlan {
  const all = parseInbox(contents);

  const messages = all.slice(0, limit);
  const rest = all.slice(limit);

  return {
    messages,
    remainder: rest.length > 0 ? rest.join(`\n${RECORD_SEPARATOR}\n`) : '',
    deferred: rest.length,
  };
}

/** How a drained batch went, for the summary the user sees. */
export interface DrainSummary {
  /** Messages that became a draft awaiting confirmation. */
  queued: number;
  /** Messages already in the queue — a re-run, or a duplicated automation. */
  duplicates: number;
  /** Messages the parser did not recognise as a transaction (OTP, promo…). */
  ignored: number;
  /** Left in the file for the next drain because of the cap. */
  deferred: number;
}

export const EMPTY_SUMMARY: DrainSummary = {
  queued: 0,
  duplicates: 0,
  ignored: 0,
  deferred: 0,
};

/**
 * One line describing a drain, for the toast or alert after it runs.
 *
 * Written to be readable by someone who does not know what "parse" means, and
 * to stay silent about zeroes — "3 added" rather than
 * "3 added, 0 duplicates, 0 ignored".
 */
export function describeDrain(summary: DrainSummary): string {
  const parts: string[] = [];

  if (summary.queued > 0) {
    parts.push(`${summary.queued} transaction${summary.queued === 1 ? '' : 's'} to review`);
  }
  if (summary.duplicates > 0) parts.push(`${summary.duplicates} already added`);
  if (summary.ignored > 0) {
    parts.push(`${summary.ignored} not a transaction`);
  }
  if (summary.deferred > 0) parts.push(`${summary.deferred} left for next time`);

  if (parts.length === 0) return 'No new messages.';
  return parts.join(' · ');
}
