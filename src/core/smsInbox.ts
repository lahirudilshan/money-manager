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

/**
 * The file Shortcuts appends to, in the root of the app's Documents folder.
 *
 * "temp-" is doing real work in that name. The file is a HANDOFF, not storage:
 * the automation appends to it, the app moves each message into the `sms_inbox`
 * table and clears it, and the queue the user actually reviews lives in the
 * database. Someone browsing Files needs to know at a glance that this is not
 * where their transactions are kept and that it is safe to see empty.
 *
 * No subfolder. Documents' root is one less level for the user to navigate in
 * the Shortcuts folder picker, and the subfolder's original justification —
 * keeping the app's SQLite directory out of view — disappeared when the
 * database moved to Application Support (see db/client.ts).
 */
export const INBOX_FILENAME = 'temp-sms-inbox.txt';

/**
 * What the user types into Shortcuts' File Path field.
 *
 * Just the filename now that the inbox sits in Documents' root. Kept as its own
 * export so the guide, the copy button and the file itself cannot disagree.
 */
export const INBOX_RELATIVE_PATH = INBOX_FILENAME;

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
 *   - surrounding whitespace on each message;
 *   - the separator GLUED to the end of a message rather than on its own line.
 *
 * That last one is the important one, and it was a real bug. Requiring `---` to
 * occupy a whole line looked reasonable, but the natural way to build the
 * Shortcut — appending "<message>---" in one Text action — produces
 * `...Hot Line:0112462462---` and matched nothing. Six messages then parsed as
 * ONE record and five real transactions vanished with no error anywhere, which
 * is the worst possible failure for an intake path the user cannot inspect.
 *
 * So the separator is now any run of three-or-more dashes wherever it appears,
 * as long as it is not inside a word. A bank message can contain a dash, and
 * even " - " between clauses, but three consecutive dashes mid-sentence is not
 * something these alerts do — whereas a trailing `---` is something users do
 * constantly.
 *
 * Returns messages in file order, which is arrival order.
 */
export function parseInbox(contents: string): string[] {
  if (!contents) return [];

  return contents
    .replace(/\r\n/g, '\n')
    .split(SEPARATOR_PATTERN)
    .map(stripComments)
    .filter((record) => record.length > 0);
}

/**
 * Drop `#` comment lines from a record, then trim it.
 *
 * This is what keeps the seed header from eating the first real message, and it
 * was a total-loss bug: the header ends with prose, not a separator, so a
 * Shortcut appending `<message>---` produces
 *
 *   # ...header lines...
 *   # End each message with three dash characters...
 *   LKR 1,038.30 debited from AC 6796---
 *
 * whose FIRST record is the whole header glued to the first message. `parseSms`
 * sees a block starting in `#`, rejects it, and the drain counts it as "not a
 * transaction" — then clears the file. The message is gone, no error anywhere,
 * and the user watches the text disappear from the Files app with nothing
 * arriving in the app. Messages 2..N were unaffected, which is why this looked
 * intermittent rather than systematic.
 *
 * Stripping the comment lines rather than the whole record is what makes the
 * message survive: the header contributes only `#` lines, so removing them
 * leaves exactly the bank text behind. A record that was ONLY header collapses
 * to an empty string and is filtered out by the caller, which is how a drained
 * file with just the header still reads as empty.
 *
 * Applies to any `#` line, not only the seed header, so a user who annotates
 * their own inbox does not corrupt the message next to the note.
 */
function stripComments(record: string): string {
  return record
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .trim();
}

/**
 * Three-or-more dashes, treated as a record boundary wherever they occur.
 *
 * Three-or-more rather than exactly three, because an automation that pads the
 * separator (`-----`) is making the same gesture and should not silently glue
 * every message together. Global so `split` finds every occurrence.
 */
const SEPARATOR_PATTERN = /-{3,}/g;

/**
 * A stable fingerprint of a message, used as the queue's dedupe key.
 *
 * Normalised before hashing so the trivial differences between two deliveries
 * of the same alert — a trailing newline, CRLF from one Shortcuts action and LF
 * from another, runs of spaces — do not read as two distinct messages. Case is
 * folded for the same reason.
 *
 * Deliberately NOT a cryptographic hash: this guards against accidental repeats,
 * not against an adversary, and a 32-bit FNV-1a over normalised text plus the
 * length is ample for the handful of messages a phone sees in a month while
 * needing no native module. The length suffix makes the common collision shapes
 * (anagram-ish texts of different sizes) impossible.
 *
 * Two genuinely distinct transactions that produce identical text — the same
 * amount at the same shop on the same second — would collide and the second
 * would be dropped. That is the intended trade: a bank alert carries a
 * timestamp, so real duplicates of this kind are re-sends, not new spends.
 */
export function fingerprintMessage(message: string): string {
  const normalised = message.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();

  // FNV-1a, 32-bit. `>>> 0` keeps it unsigned after the multiply overflows.
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalised.length; index += 1) {
    hash ^= normalised.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${hash.toString(36)}-${normalised.length.toString(36)}`;
}

/** The minimum a record needs for reversal pairing. Matches `ParsedSms`. */
export interface CancellableEntry {
  kind: string;
  direction: string;
  amountMinor: number;
  account: string;
}

/**
 * Drop each reversal together with the ONE charge it undoes.
 *
 * A reversal is not income — it is a charge being taken back, and a bank sends
 * both messages. Left alone the user sees a spend AND a credit for the same
 * money, and confirming either one puts a wrong figure on the board.
 *
 * The rule is one-for-one, deliberately. A card that is charged, reversed, then
 * charged again produces three messages, and only the LAST charge is real:
 *
 *   debit 1,038.30   ─┐ cancelled as a pair
 *   reversal 1,038.30 ┘
 *   debit 1,038.30    → survives
 *
 * So each reversal consumes a single matching debit rather than every debit of
 * that amount. Matching runs newest-first over the entries preceding the
 * reversal, because a reversal undoes the charge that came before it.
 *
 * A reversal with no matching debit is KEPT. That is money genuinely arriving —
 * a refund for something bought before the app was installed, or in a batch the
 * user has already reviewed — and dropping it would hide a real credit.
 *
 * Entries must be in arrival order (oldest first), which is how the inbox file
 * and the queue both store them.
 */
export function cancelReversals<T extends CancellableEntry>(entries: readonly T[]): T[] {
  const dropped = new Set<number>();

  entries.forEach((entry, index) => {
    if (entry.kind !== 'reversal') return;

    /*
     * Search BACKWARDS from just before the reversal.
     *
     * The charge a reversal undoes always precedes it, and scanning newest-first
     * means the most recent identical charge is consumed — which is what makes
     * the charge/reverse/charge sequence above leave the final charge standing.
     */
    for (let i = index - 1; i >= 0; i -= 1) {
      if (dropped.has(i)) continue;

      const candidate = entries[i];
      const matches =
        candidate.direction === 'debit' &&
        candidate.amountMinor === entry.amountMinor &&
        // Same account, when both messages name one. Some banks omit it on the
        // reversal, and an amount match alone is strong enough to pair on.
        (!candidate.account || !entry.account || candidate.account === entry.account);

      if (matches) {
        dropped.add(i);
        dropped.add(index);
        break;
      }
    }
  });

  return entries.filter((_, index) => !dropped.has(index));
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
