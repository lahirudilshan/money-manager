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

  /*
   * Comments are stripped BEFORE any record splitting.
   *
   * Order matters here and getting it wrong is not subtle. The seed header
   * shows the user what a record looks like — `{the whole message text}` — and
   * extracting braces first turns that illustration into two phantom records on
   * every single drain, forever. `stripComments` afterwards cannot help: by
   * then the text has already been lifted out of its `#` line.
   *
   * Stripping first also means a user who annotates their own inbox ("# this
   * one was a refund") cannot accidentally create a record, whichever format
   * they are using.
   */
  const text = stripComments(contents.replace(/\r\n/g, '\n'));

  /*
   * BRACED records win outright when any are present.
   *
   * `{...}` wrapping is strictly better than a separator, and the difference is
   * not cosmetic — it is the difference between a detectable error and silent
   * corruption. A separator sits BETWEEN messages, so a Shortcut that forgets
   * to write one produces text that is still perfectly valid input: two
   * messages become one record, and the parser reads the first amount it finds
   * out of whichever message happens to come first.
   *
   * That is not hypothetical. It happened on the user's device: a P2P
   * notification and a Dialog POS purchase merged into a single record, and the
   * row stored LKR 10,000.00 for a transaction that was actually LKR 50.00 —
   * two hundred times too high, with the merchant read correctly from the
   * SECOND message and the amount from the FIRST. Nothing anywhere could detect
   * it, because a missing separator leaves no trace.
   *
   * A brace, by contrast, DELIMITS each message on both sides. A missing one
   * yields text outside any braces, which is visibly wrong and can be reported
   * rather than silently mis-parsed.
   *
   * Mixed content is handled deliberately: braced records are extracted, and
   * anything outside them falls through to the legacy separator path below, so
   * a user midway through updating their Shortcut loses nothing.
   */
  // `flatMap` through `recoverUnclosed`, so a capture that swallowed the next
  // record because a closing brace was missing still yields both messages.
  const braced = [...text.matchAll(BRACED_RECORD_PATTERN)].flatMap((match) =>
    recoverUnclosed(match[1]),
  );

  if (braced.length > 0) {
    // Whatever sits outside the braces — a half-written record, or messages
    // from a Shortcut run before the format changed.
    let leftovers = text.replace(BRACED_RECORD_PATTERN, '\n');

    /*
     * Rescue a record whose closing brace never arrived.
     *
     * It survives in the leftovers as a trailing `{...` with no `}`. Recovering
     * it here — rather than letting it fall through to the legacy splitter,
     * which would keep the stray brace in the message text — means a single
     * missed keystroke costs nothing.
     */
    const unclosed = leftovers.match(UNCLOSED_RECORD_PATTERN);
    if (unclosed) {
      braced.push(unclosed[1]);
      leftovers = leftovers.slice(0, unclosed.index);
    }

    return finalise([...braced, ...splitLegacyRecords(leftovers)]);
  }

  return finalise(splitLegacyRecords(text));
}

/**
 * Strip comments, recover merged messages, drop what is left empty.
 *
 * The merge recovery runs on EVERY path, braced included: a user can wrap two
 * alerts in one pair of braces just as easily as they can forget a separator,
 * and the cost of checking is a regex over a short string.
 */
function finalise(records: string[]): string[] {
  return records
    .map(stripComments)
    .flatMap((record) => (record.length > 0 ? splitMergedMessages(record) : []))
    .map((record) => record.trim())
    .filter((record) => record.length > 0);
}

/**
 * A `{...}` record. Non-greedy so consecutive records do not swallow each
 * other, and `[\s\S]` so a multi-line bank message (they are common — HNB's ATM
 * receipt runs to nine lines) is captured whole.
 *
 * Braces are safe as delimiters here because bank alerts do not contain them:
 * they carry currency, digits, punctuation and the occasional asterisk, but a
 * brace has no place in one. A message that somehow did contain a closing brace
 * would end its record early, leaving the remainder as a separate record the
 * parser rejects — visible breakage rather than a wrong amount.
 */
const BRACED_RECORD_PATTERN = /\{([\s\S]*?)\}/g;

/**
 * A record whose closing brace is missing, ended by the NEXT record's opening
 * brace or by the end of the file.
 *
 * Without this an unterminated `{` swallows everything after it: the regex
 * above finds no closing brace until the *following* record's, so two messages
 * collapse into one and the second is lost. A dropped keystroke in Shortcuts is
 * an easy way to produce exactly that, and the whole point of moving to braces
 * was to stop a formatting slip from costing a transaction.
 *
 * Applied only to text left over after the well-formed records are taken, so a
 * correctly-braced file never reaches it.
 */
const UNCLOSED_RECORD_PATTERN = /\{([^{}]*)$/;

/**
 * Recover records from a capture that swallowed a following one.
 *
 * When a closing brace is missing, the non-greedy `{...}` match does not stop
 * where the record should have ended — it runs on to the NEXT record's closing
 * brace, so the captured text is really two messages with a stray `{` between
 * them:
 *
 *   "{A\n{B}"  captures  "A\n{B"     ← two records, one capture
 *
 * The leftover text is empty in that case, so there is nothing outside the
 * braces to rescue; the split has to happen INSIDE the capture. Splitting on
 * the stray opening brace restores both.
 *
 * A capture with no inner `{` is returned untouched, which is every
 * well-formed record.
 */
function recoverUnclosed(captured: string): string[] {
  if (!captured.includes('{')) return [captured];
  return captured.split('{');
}

/** The original `---`-separated format, kept so existing Shortcuts still work. */
function splitLegacyRecords(text: string): string[] {
  return text.split(SEPARATOR_PATTERN);
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

/**
 * How far apart the two halves of one internal transfer may be, in minutes.
 *
 * The sending and receiving banks alert independently, so the two messages are
 * never simultaneous — in the observed data an HNB debit at 11:57:03 pairs with
 * an NDB credit at 11:57, and a second pair spans 12:00:49 → 12:00. Interbank
 * (CEFTS/SLIPS) settlement can lag a few minutes more, so the window is wider
 * than the observed gap but far short of the hours that would let two unrelated
 * transfers of a similar size pair up.
 */
export const INTERNAL_TRANSFER_WINDOW_MINUTES = 15;

/**
 * The share of the amount that may differ between the two halves, to absorb the
 * transfer fee.
 *
 * The sender is debited 10,025.00 and the receiver credited 10,000.00 — the 25
 * is the bank's CEFTS charge, which arrives as its own separate SMS. Requiring
 * an exact match would leave both halves of every real transfer on the board.
 *
 * 2% of the larger side, floored at a small absolute allowance so tiny
 * transfers still pair (2% of 500 is 10, less than a flat 25 fee).
 */
const INTERNAL_TRANSFER_FEE_TOLERANCE = 0.02;
const INTERNAL_TRANSFER_MIN_FEE_ALLOWANCE = 5000; // 50.00 in minor units

/**
 * Where a new bank alert starts, for splitting a record that holds several.
 *
 * These messages have a very consistent opening: a currency code or "Rs." and
 * an amount, followed within a few words by a movement verb. That shape is
 * distinctive enough to find a message boundary INSIDE a blob of text, which is
 * what recovering a merged record needs.
 *
 * Anchored to a line start or a sentence end so it cannot fire on the amount in
 * the middle of a sentence ("...of LKR 5,000.00 is..."), only on text that
 * genuinely reads like the beginning of a fresh alert.
 */
/**
 * A currency figure anywhere in a record's leading text.
 *
 * Used to tell a greeting ("Dear Customer,") from a genuinely separate message
 * ("You received LKR 10,000 from ..."). Only the latter carries an amount, and
 * only the latter can poison the amount read for the alert that follows it.
 */
const PREAMBLE_AMOUNT_PATTERN =
  /(?:LKR|USD|EUR|GBP|AUD|AED|SGD|INR|Rs\.?)\s*[\d,]+(?:\.\d{1,2})?/i;

const MESSAGE_START_PATTERN =
  /(?:^|\n)\s*((?:LKR|USD|EUR|GBP|AUD|AED|SGD|INR|Rs\.?)\s*[\d,]+(?:\.\d{1,2})?\s+(?:debited|credited|withdrawn|spent|paid))/gi;

/**
 * Split a record that turns out to hold MORE THAN ONE bank alert.
 *
 * The repair for a Shortcut that appended without a separator. The user's
 * device had exactly this: a P2P notification and a Dialog POS purchase stored
 * as one record, whose amount was read from the wrong message — LKR 10,000.00
 * recorded for a LKR 50.00 purchase.
 *
 * Conservative by construction. It only splits where a new alert DEMONSTRABLY
 * begins (an amount immediately followed by a movement verb, at a line or
 * sentence boundary), and a record with one such point is returned untouched.
 * So an ordinary single message — including a multi-line one that mentions
 * several figures — is never carved up; only text that contains two distinct
 * message openings is.
 *
 * Returns the pieces in order, or `[record]` when there is nothing to split.
 */
export function splitMergedMessages(record: string): string[] {
  const starts: number[] = [];
  for (const match of record.matchAll(MESSAGE_START_PATTERN)) {
    // Index of the amount itself, not of the leading whitespace/newline.
    starts.push((match.index ?? 0) + match[0].indexOf(match[1]));
  }

  if (starts.length === 0) return [record];

  /*
   * A single alert preceded by unrelated text is ALSO a merged record.
   *
   * Requiring two amount-first openings missed the real case entirely. The
   * user's corrupted row was a peer-to-peer notification — "You received LKR
   * 10,000 from DILSHAN M N L", which opens with words, not an amount —
   * followed by a genuine "LKR 50.00 debited..." purchase. Only the purchase
   * matched, so the record looked single and was left merged, and the parser
   * went on reading 10,000 out of the preamble for a 50-rupee transaction.
   *
   * So one match still splits, provided there is real text in front of it. The
   * preamble is preserved as its own piece and judged by `parseSms` like any
   * other — which rejects this one as an accountless notification, exactly as
   * it should.
   */
  if (starts.length === 1) {
    const preamble = record.slice(0, starts[0]).trim();

    /*
     * A preamble only counts as a SEPARATE message if it looks like one.
     *
     * Plenty of real alerts open with a greeting or a bank name before stating
     * the amount — "Dear Customer,\nLKR 500.00 spent at SPAR." is one message,
     * and splitting it would invent a second transaction out of a salutation.
     * That was a regression this guard exists to prevent.
     *
     * The discriminator is whether the preamble carries its OWN money figure.
     * A greeting does not; the peer-to-peer notification that caused the real
     * corruption does ("You received LKR 10,000 from..."), and it is precisely
     * that stray amount which the parser would otherwise attribute to the alert
     * below it. So: an amount up there means two messages, no amount means one.
     */
    if (!PREAMBLE_AMOUNT_PATTERN.test(preamble)) return [record];
  }

  /*
   * Text before the FIRST alert is prepended to it rather than dropped.
   *
   * That leading text is usually a seed header or a notification that belongs
   * with nothing, but discarding it here would silently destroy content — and
   * this function's whole justification is that silent destruction is what went
   * wrong. `parseSms` decides what is real; this only finds boundaries.
   */
  const pieces: string[] = [];
  const preamble = record.slice(0, starts[0]).trim();

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : record.length;
    pieces.push(record.slice(start, end).trim());
  });

  if (preamble.length > 0) pieces.unshift(preamble);

  return pieces.filter((piece) => piece.length > 0);
}

/**
 * The accounts the user owns, learned from the messages themselves.
 *
 * Internal-transfer pairing needs to know which accounts are the user's — that
 * is the entire safety mechanism separating "I moved my own money" from "I paid
 * someone". The obvious source is `cards.last4`, and it is the RIGHT source
 * when populated. It usually is not: a user picks their banks from brand tiles
 * during onboarding and is never asked for account numbers, so every card ends
 * up with `last4 = NULL`, `ownAccounts` comes back empty, and pairing silently
 * does nothing. Observed exactly this on the user's device — eight rows queued,
 * four of them halves of two internal transfers, because five cards all had a
 * null last4.
 *
 * So the accounts are also INFERRED. The reasoning: every message in this queue
 * was delivered to the user's own phone by their own bank about their own
 * account. An account fragment that appears there at all is therefore theirs —
 * it cannot be a stranger's, because strangers' banks do not text this handset.
 * A counterparty is named in prose ("from DILSHAN M N L"), never in the
 * `A/C:`/`Ac No:` field that `extractAccount` reads.
 *
 * Fragments seen only ONCE are still included: a second account often shows up
 * exactly once (one leg of one transfer), and requiring repetition would defeat
 * the very case this exists for.
 *
 * Union rather than replacement — a real `last4` the user typed is kept, so
 * this only ever adds knowledge.
 */
export function inferOwnAccounts(
  /** Account fragments from the queue's messages, in any order. */
  seen: readonly string[],
  /** Last-4s the user actually recorded on their cards. */
  recorded: readonly string[] = [],
): string[] {
  const accounts = new Set<string>();

  for (const last4 of recorded) {
    if (last4) accounts.add(last4);
  }

  for (const account of seen) {
    // Two digits is not an account — it is noise that would `endsWith`-match
    // half the world. HNB's visible tail is exactly two ("Ac No:13802XXXXX50"),
    // and it IS usable for pairing because pairing compares fragments to each
    // other rather than to a card, so the floor is lower here than
    // `isMatchableAccount`'s. Below two digits there is nothing to compare.
    if (account && account.length >= 2) accounts.add(account);
  }

  return [...accounts];
}

/** The minimum an entry needs for internal-transfer pairing. */
export interface PairableEntry {
  kind: string;
  direction: string;
  amountMinor: number;
  account: string;
  /** ISO "YYYY-MM-DD", or null when the message stated no date. */
  date: string | null;
  /** 24-hour "HH:MM", or null. */
  time: string | null;
}

/** Minutes since epoch-ish, for comparing two messages. Null when undatable. */
function minutesOf(entry: PairableEntry): number | null {
  if (!entry.date || !entry.time) return null;
  const at = Date.parse(`${entry.date}T${entry.time}:00Z`);
  return Number.isFinite(at) ? at / 60000 : null;
}

/** Whether two amounts agree once a plausible transfer fee is allowed for. */
function amountsPairable(a: number, b: number): boolean {
  const larger = Math.max(a, b);
  const allowance = Math.max(larger * INTERNAL_TRANSFER_FEE_TOLERANCE, INTERNAL_TRANSFER_MIN_FEE_ALLOWANCE);
  return Math.abs(a - b) <= allowance;
}

/**
 * Drop both halves of every transfer BETWEEN THE USER'S OWN ACCOUNTS.
 *
 * This app tracks income and expenses. Moving your own money from HNB to NDB is
 * neither: nothing was earned and nothing was spent, the total across your
 * accounts is unchanged. Left alone the pair inflates BOTH sides of the month —
 * the credit reads as income, the debit as spend — and every derived figure
 * (savings rate, category totals, "how much did I spend this month") is wrong by
 * the transferred amount. Over a month of topping up one account from another,
 * that error dwarfs the real numbers.
 *
 * A pair must satisfy ALL of:
 *   - opposite directions (one debit, one credit);
 *   - both are transfer-shaped (`transfer_in` / `transfer_out`) — a POS purchase
 *     is never half of an internal transfer, however well the amount lines up;
 *   - amounts agree once a transfer fee is allowed for (see above);
 *   - they occurred within `INTERNAL_TRANSFER_WINDOW_MINUTES` of each other;
 *   - they name DIFFERENT accounts, both of which the user owns.
 *
 * That last condition is what makes this safe, and it is why `ownAccounts` is a
 * required argument rather than an inferred one. The real data contains a
 * genuine outward transfer of exactly 10,000.00 — money sent to the user's
 * parents — sitting minutes away from an internal pair of the same size. What
 * separates them is not the amount or the wording but the COUNTERPARTY: the
 * internal pair has a matching credit landing on another account of the user's,
 * and the payment to the parents does not. Pairing on amount and time alone
 * would silently delete that real expense.
 *
 * Entries must be in arrival order. Returns the survivors, order preserved.
 */
export function cancelInternalTransfers<T extends PairableEntry>(
  entries: readonly T[],
  /** Last-4 (or visible tail) of every account the user owns. */
  ownAccounts: readonly string[],
): T[] {
  // With fewer than two known accounts an internal transfer is impossible: the
  // money would have nowhere of the user's to land.
  if (ownAccounts.length < 2) return [...entries];

  /** Whether a message's account fragment belongs to one of the user's cards. */
  const owned = (account: string): string | null => {
    if (!account) return null;
    // The message shows a tail; a card holds its last-4. Either may be the
    // shorter of the two, so compare in whichever direction has enough digits.
    const hit = ownAccounts.find(
      (own) => own && (account.endsWith(own) || own.endsWith(account)),
    );
    return hit ?? null;
  };

  const dropped = new Set<number>();

  entries.forEach((entry, index) => {
    if (dropped.has(index)) return;
    if (entry.kind !== 'transfer_out' && entry.kind !== 'transfer_in') return;

    const account = owned(entry.account);
    if (!account) return;

    const when = minutesOf(entry);

    for (let i = 0; i < entries.length; i += 1) {
      if (i === index || dropped.has(i)) continue;

      const other = entries[i];
      if (other.direction === entry.direction) continue;
      if (other.kind !== 'transfer_out' && other.kind !== 'transfer_in') continue;

      const otherAccount = owned(other.account);
      // Both sides must be the user's, and they must be DIFFERENT accounts —
      // otherwise a debit and credit on one account is just two transactions.
      if (!otherAccount || otherAccount === account) continue;

      if (!amountsPairable(entry.amountMinor, other.amountMinor)) continue;

      /*
       * Placeable in time — by the clock when both sides print one, and
       * otherwise by the DAY they share.
       *
       * The strict rule was: no timestamp, no pairing. It exists to stop a real
       * payment being deleted by an amount coincidence, which is the right
       * instinct — but it was too strict for banks that print no time at all.
       * DFCC sends "on 02 SEP 2026" with no clock, so a genuine LKR 282,534
       * transfer to the user's own NDB account could never pair, and both
       * halves surfaced as separate spends.
       *
       * The relaxation is narrow and rests on what is already required above:
       * BOTH accounts must be the user's, and they must be DIFFERENT accounts.
       * Money moving between two accounts one person owns, in opposite
       * directions, for the same amount, on the same calendar day is a transfer
       * — the coincidence this guards against would require the user to also
       * pay a stranger the identical sum from the identical account that day.
       *
       * A shared clock still wins where both sides have one: the 15-minute
       * window is tighter than a day and rules out two genuinely separate
       * same-day transfers of equal size.
       */
      const otherWhen = minutesOf(other);
      if (when !== null && otherWhen !== null) {
        if (Math.abs(when - otherWhen) > INTERNAL_TRANSFER_WINDOW_MINUTES) continue;
      } else if (!entry.date || !other.date || entry.date !== other.date) {
        // No usable clock on one side: fall back to the calendar day, and
        // refuse when even that is unknown.
        continue;
      }

      dropped.add(index);
      dropped.add(i);
      break;
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
  /**
   * Halves of own-account transfers dropped as neither income nor spend.
   *
   * Counted so the summary line can account for messages that arrived and
   * produced no draft — otherwise a drain of four internal-transfer alerts
   * reports "No new messages" while the file visibly emptied, which reads as
   * the intake being broken.
   */
  internalTransfers: number;
  /**
   * Bank fees that arrived pre-sorted onto the charges line.
   *
   * Kept for the drain report even though they are no longer filed away — they
   * queue like any other draft now, just with their category already decided.
   */
  autoFiled: number;
}

export const EMPTY_SUMMARY: DrainSummary = {
  queued: 0,
  duplicates: 0,
  ignored: 0,
  deferred: 0,
  internalTransfers: 0,
  autoFiled: 0,
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
  if (summary.internalTransfers > 0) {
    // Phrased as what it MEANS, not as a count of messages: the user moved
    // their own money, and the app is telling them it deliberately did not
    // record it as income or spend.
    parts.push(
      `${summary.internalTransfers} own transfer${summary.internalTransfers === 1 ? '' : 's'} skipped`,
    );
  }
  if (summary.ignored > 0) {
    parts.push(`${summary.ignored} not a transaction`);
  }
  if (summary.deferred > 0) parts.push(`${summary.deferred} left for next time`);

  if (parts.length === 0) return 'No new messages.';
  return parts.join(' · ');
}
