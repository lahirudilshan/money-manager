/**
 * The SMS intake half of the store.
 *
 * Parsing, the review queue, the inbox drain and draft resolution — the largest
 * single subsystem, and the one with its own module-level state (the drain
 * re-entrancy guard below), which is why it is worth separating from the board
 * actions rather than leaving both in one 2500-line file.
 *
 * A zustand slice, not an independent store: it receives the same `set`/`get`
 * as every other action, so `get().refreshBoard()` and `get().cards` work here
 * exactly as they did inline. The slice is typed against the whole AppState for
 * that reason — it reads board state it does not own.
 */

import type { StateCreator } from 'zustand';
import {
  extractStatementBill,
  isRejectedAsNoise,
  looksTruncated,
  parseSms,
  splitItemisedFee,
  type ParsedSms,
} from '~/features/sms/logic/smsParser';
import { orderDraftsWithFees, reconcileSms } from '~/features/sms/logic/smsReconcile';
import { planRuleUpsert } from '~/features/sms/logic/merchantRules';
import { logSmsIntake } from '~/features/sms/logic/smsIntakeLog';
import {
  cancelInternalTransfers,
  cancelReversals,
  inferOwnAccounts,
  splitMergedMessages,
  EMPTY_SUMMARY,
  fingerprintMessage,
} from '~/features/sms/logic/smsInbox';
import {
  countWaiting,
  drainInbox,
  ensureInboxExists,
  watchInbox,
} from '~/features/sms/logic/smsInboxFile';
import { onForeground } from '~/shared/lib/network';
import { notifyDraftsImported } from '~/shared/lib/notifications';
import {
  merchantRuleRepo,
  meterReadingRepo,
  settingsRepo,
  smsInboxRepo,
  smsLogRepo,
  stateRepo,
  transactionRepo,
  SETTINGS_KEYS,
} from '~/db/repositories';
import type { AppState } from '~/store/useAppStore';

/**
 * Whether a drain is in flight.
 *
 * Module-level rather than store state on purpose: it must be readable and
 * writable synchronously within one drain, and putting it in the store would
 * publish a meaningless flag to every subscriber and re-render the board twice
 * per import. See the guard in `drainSmsInbox`.
 */
let draining = false;

/**
 * What the most recent drain actually did, for the diagnostics alert.
 *
 * The drain has several branches that all end with "file cleared, nothing on
 * screen", and from the outside they are indistinguishable — which is why this
 * feature has been so hard to pin down. Recording the counts plus the pending
 * row total makes the branch that fired obvious: a message that was `queued` but
 * left zero pending rows is a UI/publish problem, one that came back
 * `duplicate` is a fingerprint already in the table, and one counted `ignored`
 * is a parser gap.
 *
 * Module-level and overwritten each drain: it is a live debugging aid, not
 * history.
 */
export let lastDrainReport: {
  at: number;
  messages: number;
  queued: number;
  duplicates: number;
  ignored: number;
  pendingRows: number;
  draftsInStore: number;
} | null = null;

/**
 * Fingerprints of messages already reported as unreadable this session.
 *
 * A message the parser cannot read is now LEFT IN THE FILE rather than
 * destroyed, so it is re-encountered on every poll tick. This keeps the
 * diagnostics panel showing it once instead of ten identical rows.
 *
 * Module-level and never pruned: it holds at most a handful of short strings
 * for the life of the process, and clearing it on drain would defeat the point.
 */
const loggedUnreadable = new Set<string>();

/** The actions this slice contributes. Derived from AppState so it cannot drift. */
export type SmsSlice = Pick<
  AppState,
  | 'ingestSmsText'
  | 'pruneSmsQueue'
  | 'loadSmsDrafts'
  | 'smsInboxWaiting'
  | 'refreshInboxCount'
  | 'drainSmsInbox'
  | 'watchSmsInbox'
  | 'syncSmsNow'
  | 'confirmDraft'
  | 'dismissDraft'
>;

export const createSmsSlice: StateCreator<AppState, [], [], SmsSlice> = (set, get) => ({
  ingestSmsText(text) {
    const parsed = parseSms(text);
    if (!parsed) return null;

    /*
     * Persist BEFORE building the draft.
     *
     * The queue is a table now, so the duplicate check is the unique index on
     * `fingerprint` rather than a scan of what happens to be in memory. That
     * closes the hole the in-memory check left open: the same alert arriving
     * after a restart used to sail through, because the previous draft had
     * evaporated with the process.
     */
    const fingerprint = fingerprintMessage(parsed.raw);

    const inserted = smsInboxRepo.add({
      raw: parsed.raw,
      fingerprint,
      direction: parsed.direction,
      kind: parsed.kind,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      merchant: parsed.merchant,
      account: parsed.account,
      occurredOn: parsed.date,
      occurredAt: parsed.time,
    });

    /*
     * A repeat of a message the user already RESOLVED comes back for review.
     *
     * `add` returns false for two very different situations, and collapsing
     * them is what made a re-sent message disappear for good: the row may still
     * be pending (already on screen — nothing to do), or it may have been
     * confirmed/dismissed earlier, in which case the fingerprint blocks the
     * insert forever and the message is consumed from the file with nothing to
     * show for it. Reopening the resolved row puts it back in the queue.
     *
     * This is also what makes testing possible at all: sending yourself the same
     * alert twice used to work exactly once per install.
     */
    if (!inserted && !smsInboxRepo.isPending(fingerprint)) {
      smsInboxRepo.reopen(fingerprint);
      get().loadSmsDrafts();
      return get().smsDrafts.find((draft) => draft.parsed.raw === parsed.raw)?.id ?? null;
    }

    // 'duplicate' rather than null: the caller logs the outcome, and reporting
    // this as a parse failure made a successful deep link show an error beside
    // its own success (both the layout listener and the sms/index route ingest
    // a cold-start link, so the second delivery always lands here).
    if (!inserted) return 'duplicate';

    /*
     * A receipt that itemises a fee produces a SECOND row for it.
     *
     * An ATM e-receipt states two movements — "Amt(Approx.): 85000.00" and
     * "Txn Fee: 30.00" — and only the first used to survive. The fee was read
     * by `extractAmount`, recognised as not-the-transaction, and discarded, so
     * the account fell by 85,030 while the board recorded 85,000 and nothing
     * explained the gap.
     *
     * Queued, never auto-filed, exactly like the CEFTS charge: `reconcileSms`
     * sorts it onto the Bank charges line and the user confirms it. Inserted
     * directly rather than through a recursive `ingestSmsText` call, because
     * the synthetic text is not something `parseSms` should have to accept as
     * input — it is a movement this function already holds.
     *
     * Failure here is deliberately non-fatal: the withdrawal is the important
     * row, and losing the fee is far better than losing both.
     */
    const fee = splitItemisedFee(parsed);
    if (fee) {
      smsInboxRepo.add({
        raw: fee.raw,
        fingerprint: fingerprintMessage(fee.raw),
        direction: fee.direction,
        kind: fee.kind,
        amountMinor: fee.amountMinor,
        currency: fee.currency,
        merchant: fee.merchant,
        account: fee.account,
        occurredOn: fee.date,
        occurredAt: fee.time,
      });
    }

    /*
     * A utility statement leaves its METER READING behind.
     *
     * Recorded here — on arrival — rather than when the user confirms the bill,
     * because the reading is a fact the utility stated and is true whether or
     * not the bill is ever logged against a budget line. Tying it to
     * confirmation would punch a hole in the usage chart for every statement
     * dismissed as a duplicate, and those are the months the user is most
     * likely to want to compare against.
     *
     * Wrapped because a chart is not worth losing a bill over: if the reading
     * cannot be stored, the draft above still stands.
     */
    const statement = extractStatementBill(parsed.raw);
    if (statement?.accountNumber && statement.readingDate) {
      try {
        meterReadingRepo.record({
          accountNumber: statement.accountNumber,
          biller: parsed.merchant,
          // "YYYY-MM" from the reading date — the month the usage belongs to.
          period: statement.readingDate.slice(0, 7),
          readingDate: statement.readingDate,
          units: statement.units,
          readingCurrent: statement.readingCurrent,
          readingPrevious: statement.readingPrevious,
          totalDueMinor: statement.totalDueMinor,
          monthlyBillMinor: statement.monthlyBillMinor,
        });
      } catch {
        // Non-fatal by design — see above.
      }
    }

    // Rebuild from the table so the rows the user sees are exactly the rows
    // that are stored — no path where the two can drift apart.
    get().loadSmsDrafts();

    return get().smsDrafts.find((draft) => draft.parsed.raw === parsed.raw)?.id ?? null;
  },

  /**
   * Re-apply the intake rules to rows ALREADY sitting in the queue.
   *
   * The drain applies noise rejection and pair-cancellation to one batch, at
   * the moment messages leave the file. That leaves a gap the user hit
   * directly: rows queued by an earlier build stay exactly as that build
   * classified them, so improving the parser or adding a cancellation rule does
   * nothing for the eight messages already on their dashboard. Their Smart
   * Detect showed both halves of two internal transfers plus a row whose
   * merchant was their own bank balance, none of which any later drain would
   * ever revisit.
   *
   * So this is the retroactive pass. It re-parses each pending row from `raw`
   * (the fixed parser, not the snapshot that was stored) and dismisses:
   *
   *   - rows the current parser now recognises as noise — an OTP or promo that
   *     an older, more permissive parser let through;
   *   - both halves of every own-account transfer pair.
   *
   * Dismissed rather than deleted, exactly as `dismissDraft` does, so each
   * fingerprint still blocks a re-import. Idempotent: a second run finds
   * nothing left to dismiss, which is what makes it safe to call on every
   * launch.
   *
   * Returns how many rows it retired, for the caller to report or log.
   */
  pruneSmsQueue() {
    const rows = smsInboxRepo.pending();
    if (rows.length === 0) return 0;

    /*
     * Repair rows holding MORE THAN ONE message before anything else.
     *
     * A Shortcut that appended without a separator stored two alerts as one
     * row, and the amount was read out of the wrong one — the user's device had
     * LKR 10,000.00 recorded for a LKR 50.00 Dialog purchase, 200x too high.
     * Re-parsing alone cannot fix that: the row's `raw` genuinely contains both
     * messages, so any parser reading it will keep picking one message's amount
     * and another's merchant.
     *
     * So the row is split into its constituent messages, each re-ingested as
     * its own row (the fingerprint index makes an already-present piece a
     * no-op), and the merged original dismissed. Done first so the pruning
     * below sees the recovered pieces — one of them may be half of a transfer
     * pair, which it could never be while buried in a blob.
     */
    let splitRows = 0;
    for (const row of rows) {
      const pieces = splitMergedMessages(row.raw);
      if (pieces.length < 2) continue;

      // Only act when the split genuinely yields readable transactions;
      // otherwise leave the row alone rather than shredding it on a guess.
      const readable = pieces.filter((piece) => parseSms(piece) !== null);
      if (readable.length === 0) continue;

      for (const piece of readable) get().ingestSmsText(piece);
      smsInboxRepo.resolve(row.id, 'dismissed');
      splitRows += 1;
    }

    /*
     * Refresh the STORED parse of every pending row.
     *
     * The columns are a snapshot taken by whichever parser was current when the
     * message was drained, and nothing ever rewrote them. So a row queued
     * before `bank_charge` existed still reads `kind = 'transfer_out'`, and any
     * code reading the column — rather than re-parsing `raw` — keeps acting on
     * the old verdict. That is why the user's 25.00 CEFTS charge was filed by
     * name-matching rather than recognised as a fee.
     *
     * Confirmed and dismissed rows are deliberately NOT touched: reopening a
     * row whose money is already on the board would double-count it, and
     * rewriting history to match a newer parser buys nothing.
     */
    for (const row of smsInboxRepo.pending()) {
      const fresh = parseSms(row.raw);
      if (!fresh) continue;
      if (fresh.kind === row.kind && fresh.merchant === row.merchant) continue;

      smsInboxRepo.updateParse(row.id, {
        direction: fresh.direction,
        kind: fresh.kind,
        amountMinor: fresh.amountMinor,
        currency: fresh.currency,
        merchant: fresh.merchant,
        account: fresh.account,
        occurredOn: fresh.date,
        occurredAt: fresh.time,
      });
    }

    /*
     * Recover fees from receipts ALREADY sitting in the queue.
     *
     * The split runs during ingest, so without this it only ever helps messages
     * that arrive from now on — the user's existing ATM withdrawal would keep
     * showing 85,000 with its 30-rupee charge missing, and nothing would ever
     * revisit it. Same reasoning as the re-parse above: improving the parser
     * has to reach the rows already on the dashboard.
     *
     * Idempotent by construction. The fee row's own fingerprint blocks a second
     * insert, and `splitItemisedFee` refuses to split a row that is already a
     * fee, so repeated launches add nothing.
     */
    for (const row of smsInboxRepo.pending()) {
      const parsedRow = parseSms(row.raw);
      if (!parsedRow) continue;

      const fee = splitItemisedFee(parsedRow);
      if (!fee) continue;

      smsInboxRepo.add({
        raw: fee.raw,
        fingerprint: fingerprintMessage(fee.raw),
        direction: fee.direction,
        kind: fee.kind,
        amountMinor: fee.amountMinor,
        currency: fee.currency,
        merchant: fee.merchant,
        account: fee.account,
        occurredOn: fee.date,
        occurredAt: fee.time,
      });
    }

    // Re-read: the split above may have added rows and retired others.
    const current = smsInboxRepo.pending();
    const parsed = current.map((row) => ({ row, sms: parseSms(row.raw) }));

    /*
     * A row the CURRENT parser rejects as noise.
     *
     * Deliberately not "anything that fails to parse": a row the parser simply
     * cannot read is a parser gap, and dismissing it would destroy the evidence
     * — the same distinction the drain draws. See `isRejectedAsNoise`.
     */
    const doomed = new Set(
      parsed.filter((entry) => isRejectedAsNoise(entry.row.raw)).map((entry) => entry.row.id),
    );

    // Pair-cancellation over everything still standing, in time order, so the
    // two halves of a transfer find each other even when they were drained in
    // separate batches — which is exactly how they arrived.
    const movements = parsed.filter(
      (entry): entry is { row: (typeof current)[number]; sms: ParsedSms } =>
        entry.sms !== null && !doomed.has(entry.row.id),
    );

    /*
     * Own accounts, learned from the messages as well as from the cards.
     *
     * Cards usually carry no `last4` — onboarding picks banks from brand tiles
     * and never asks for account numbers — so relying on them alone left
     * `ownAccounts` empty and pairing did nothing at all. See
     * `inferOwnAccounts`.
     */
    const ownAccounts = inferOwnAccounts(
      parsed.map((entry) => entry.sms?.account ?? ''),
      get().cards.map((card) => card.last4 ?? ''),
    );

    /*
     * Oldest first, so pairing sees the queue in the order the money moved.
     *
     * `receivedAt` breaks ties rather than leaving equal timestamps to the
     * sort's discretion: several of these alerts share a minute (the user has
     * two at 12:02), and an unstable order there would make which half of a
     * pair gets consumed vary between launches — so the same queue could prune
     * differently each time the app opened.
     */
    const ordered = [...movements].sort((a, b) => {
      const byWhen = `${a.sms.date ?? ''}${a.sms.time ?? ''}`.localeCompare(
        `${b.sms.date ?? ''}${b.sms.time ?? ''}`,
      );
      return byWhen !== 0 ? byWhen : a.row.receivedAt.getTime() - b.row.receivedAt.getTime();
    });

    const survivors = new Set(cancelInternalTransfers(ordered.map((entry) => entry.sms), ownAccounts));
    for (const entry of ordered) {
      if (!survivors.has(entry.sms)) doomed.add(entry.row.id);
    }

    for (const id of doomed) smsInboxRepo.resolve(id, 'dismissed');

    /*
     * Rows retired by the split are counted too, so the caller's number matches
     * what the user sees disappear. A split row is genuinely gone from the
     * queue even though its pieces took its place.
     */
    const retired = doomed.size + splitRows;

    if (retired > 0) get().loadSmsDrafts();
    return retired;
  },

  /**
   * Rebuild `smsDrafts` from the `sms_inbox` table.
   *
   * Matching runs here rather than at insert time because it depends on the
   * board — cards, bills, learned merchant rules — all of which change while a
   * message sits in the queue. Re-reconciling on load means a draft queued
   * yesterday is matched against the board as it is NOW, so a bill created in
   * between is picked up instead of the draft being stuck with a stale guess.
   */
  loadSmsDrafts() {
    const { subcategories, categories, cards, merchantRules, currency, usdRate } = get();

    /*
     * RE-PARSE from `raw`, falling back to the stored columns.
     *
     * The stored fields are a snapshot taken by whichever parser was current
     * when the message was drained, and reading them back meant a parser fix
     * never reached a row already in the queue. Observed directly on the user's
     * device: rows sat there with `kind:'other'` and `merchant:'Bal:LKR
     * 395,732'` — the old extractor's output — while the fixed parser read the
     * same `raw` text correctly. They would have stayed wrong forever, because
     * nothing re-visits a pending row.
     *
     * This is what `raw` was kept for (see `smsInbox` in db/schema.ts: "for a
     * future parser to re-read"). The fallback matters for a row whose text the
     * CURRENT parser rejects outright — better to show the stale snapshot than
     * to blank the row — and `pruneQueue` below is what clears those out when
     * they are genuinely noise.
     */
    const drafts = smsInboxRepo.pending().map((row) => {
      const reparsed = parseSms(row.raw);

      return reconcileSms(
        reparsed ?? {
          direction: (row.direction ?? 'debit') as ParsedSms['direction'],
          kind: (row.kind ?? 'other') as ParsedSms['kind'],
          amountMinor: row.amountMinor ?? 0,
          currency: row.currency,
          merchant: row.merchant ?? '',
          account: row.account ?? '',
          date: row.occurredOn,
          time: row.occurredAt,
          raw: row.raw,
        },
        { subcategories, categories, cards },
        // The ROW's id, so confirming a draft can resolve the row it came from.
        row.id,
        merchantRules,
        // A foreign-currency alert (an inward USD salary, say) is converted to
        // the user's currency before it is matched or logged — the board is
        // entirely in one currency, so an unconverted figure would match nothing
        // and record a salary as pocket change.
        { currency, usdRate },
      );
    });

    /*
     * Already newest-transaction-first — see `smsInboxRepo.pending`.
     *
     * This used to `.reverse()`, because the query returned arrival order. It
     * now sorts by when the money moved, so reversing here would put the OLDEST
     * transaction on top.
     */
    /*
     * ...except a fee, which follows the transaction it was charged for.
     *
     * A fee split out of an ATM receipt carries its parent's date and time, so
     * the query's date/time keys tie and arrival order decides — putting the
     * LKR 30.00 charge above the LKR 85,000.00 withdrawal that caused it. The
     * user recognises the withdrawal; the fee only makes sense beneath it.
     */
    const next = orderDraftsWithFees(drafts);

    /*
     * Publish only when the QUEUE changed, not on every call.
     *
     * This runs on every foreground and after every drain tick, and each call
     * builds a fresh array — so an unconditional `set` hands every subscriber a
     * new reference and re-renders the board even when nothing moved. Comparing
     * the row ids is enough: they are the `sms_inbox` primary keys, so a
     * different set of pending rows always yields a different list.
     */
    const current = get().smsDrafts;
    const unchanged =
      current.length === next.length &&
      current.every((draft, i) => {
        const fresh = next[i];
        // Ids alone are not enough: a draft is re-matched against the board on
        // every load, so creating a bill changes what an UNCHANGED row resolves
        // to. Comparing the match as well means a new bill shows up on a
        // waiting draft immediately, rather than after the queue next changes.
        return (
          draft.id === fresh.id &&
          draft.subcategoryId === fresh.subcategoryId &&
          draft.confidence === fresh.confidence
        );
      });

    /*
     * Publishes `smsDrafts` ONLY.
     *
     * `smsInboxWaiting` counts what is still sitting in the FILE, which is the
     * drain's business, not this function's. Zeroing it here used to be
     * harmless because nothing called this after a drain had set it — now the
     * drain does, and clearing it would erase the "left for next time" count of
     * a capped import the instant it was recorded, so the user would be told
     * nothing is waiting while 30 messages still were.
     */
    if (unchanged) return;

    set({ smsDrafts: next });
  },

  smsInboxWaiting: 0,

  refreshInboxCount() {
    set({ smsInboxWaiting: countWaiting() });
  },

  /**
   * Drain the Shortcuts inbox file into the `sms_inbox` table.
   *
   * Rows are written BEFORE the file is cleared (see `drainInbox`), so an
   * interrupted import replays rather than losing messages — the unique
   * fingerprint index makes the replay a no-op.
   *
   * Each message goes through the same `ingestSmsText` a deep link uses, so a
   * file-imported transaction is indistinguishable from a tapped one — same
   * parser, same detection, same duplicate guard.
   */
  drainSmsInbox() {
    let queued = 0;
    let duplicates = 0;
    let ignored = 0;
    /** Halves of own-account transfers dropped as not-income-and-not-spend. */
    let internalTransfers = 0;
    /** Bank fees logged straight to the charges line without review. */
    let autoFiled = 0;

    /*
     * Re-entrancy guard.
     *
     * The drain writes to the very folder the watcher is watching (it clears the
     * file, then recreates it), so every drain schedules another watcher event.
     * Without this the second drain finds an empty file and stops, but it still
     * costs a wasted read and a redundant re-render on every single import.
     */
    if (draining) return { ...EMPTY_SUMMARY };
    draining = true;

    try {
      const drained = drainInbox((messages) => {
        /*
         * Cancel reversal pairs across the WHOLE batch before anything is
         * stored.
         *
         * Pairing has to happen here rather than inside `ingestSmsText`, which
         * only ever sees one message: a reversal and the charge it undoes are
         * two separate SMS, and recognising the pair needs both in hand. Doing
         * it before the insert also means neither row is ever written, so the
         * user never sees a spend and a refund flicker into the queue and then
         * have to be tidied away.
         */
        const parsed = messages.map((raw) => ({ raw, sms: parseSms(raw) }));
        const movements = parsed.filter(
          (entry): entry is { raw: string; sms: ParsedSms } => entry.sms !== null,
        );

        /*
         * Messages the parser did not understand are counted here, since they
         * never reach `ingestSmsText` below.
         *
         * Each one is also LOGGED. This path used to be completely silent: a
         * message the parser rejected was counted, the file was cleared, and the
         * text was gone with no record of it anywhere — which is precisely the
         * "the file emptied but nothing showed up" report, and it was impossible
         * to diagnose because the evidence destroyed itself. The deep-link path
         * has always logged this; the file path never did.
         */
        /*
         * Split the rejects into NOISE and genuinely-unreadable text.
         *
         * Both fail to parse, but they must be treated oppositely. Noise (an
         * OTP, a promo blast, a message with no money wording at all) is
         * recognised and thrown away — retaining it is what let the user's
         * handoff file silently fill with marketing SMS quoting LKR amounts.
         * Text the parser simply does not understand is kept in the file, so a
         * parser gap stays visible and is fixed retroactively rather than
         * destroying a real transaction. See `isRejectedAsNoise`.
         */
        const rejected = parsed.filter((entry) => entry.sms === null).map((entry) => entry.raw);
        const noise = rejected.filter((raw) => isRejectedAsNoise(raw));
        const unreadable = rejected.filter((raw) => !isRejectedAsNoise(raw));

        /*
         * Log each unreadable message ONCE, not on every tick.
         *
         * These now stay in the file (see the return below), and the watcher
         * re-drains every couple of seconds — so an unlogged guard here would
         * refill the ten-entry diagnostics panel with the same message and push
         * out the very history the user needs to debug it.
         */
        for (const raw of unreadable) {
          const key = fingerprintMessage(raw);
          // Persisted every time (the repo upserts by fingerprint); the
          // in-memory panel is the thing that must not be spammed.
          /*
           * A message cut short is reported as SUCH, not as unreadable.
           *
           * The two need opposite responses from the user: a truncated message
           * means the Shortcut is missing its URL Encode action (a setup fix),
           * while an unreadable one is a parser gap they can do nothing about.
           * Collapsing them sent people looking in the wrong place.
           */
          const truncated = looksTruncated(raw);

          smsLogRepo.record({
            raw,
            fingerprint: key,
            outcome: truncated ? 'truncated' : 'unreadable',
            reason: truncated
              ? 'Arrived cut short — add a URL Encode step to your Shortcut'
              : 'Looks like a transaction, but could not be read',
          });

          if (loggedUnreadable.has(key)) continue;
          loggedUnreadable.add(key);
          logSmsIntake('parser-rejected', raw);
        }

        /*
         * Noise is logged too, but it is consumed rather than retained.
         *
         * Recorded so "why did my promo SMS vanish" has an answer in the
         * diagnostics panel, and so a message wrongly classified as noise —
         * the one dangerous failure mode of the self-cleaning rule — leaves a
         * trace instead of disappearing without evidence.
         */
        for (const raw of noise) {
          const key = fingerprintMessage(raw);
          smsLogRepo.record({
            raw,
            fingerprint: key,
            outcome: 'ignored',
            reason: 'Not a transaction — OTP, promo, or no money movement',
          });

          if (loggedUnreadable.has(key)) continue;
          loggedUnreadable.add(key);
          logSmsIntake('noise-discarded', raw);
        }

        ignored += rejected.length;

        /*
         * Cancel reversal pairs, then own-account transfer pairs.
         *
         * Order matters only in that both run over the whole batch before
         * anything is stored, so neither a refunded charge nor an internal
         * transfer ever flickers into the queue for the user to tidy away.
         *
         * The transfer pass needs to know which accounts are the USER'S — that
         * is the entire safety mechanism (see `cancelInternalTransfers`). A
         * batch containing a genuine 10,000 payment to a third party and an
         * internal 10,000 top-up is separable only by whether a matching credit
         * landed on another account of theirs.
         */
        /*
         * Own accounts, learned from this batch as well as from the cards —
         * see `inferOwnAccounts`. Without the inference this list is empty on
         * a normal setup and no transfer is ever cancelled.
         */
        const ownAccounts = inferOwnAccounts(
          movements.map((entry) => entry.sms.account),
          get().cards.map((card) => card.last4 ?? ''),
        );

        const afterReversals = cancelReversals(movements.map((entry) => entry.sms));
        const surviving = cancelInternalTransfers(afterReversals, ownAccounts);
        const keep = new Set(surviving);

        // Both halves of an internal transfer are dropped silently — no row, no
        // draft. They are not income and not spend, so there is nothing for the
        // user to decide, and surfacing them would re-create the noise the
        // feature exists to remove.
        internalTransfers += afterReversals.length - surviving.length;

        // Both halves of a cancelled pair are logged, so "where did my transfer
        // go?" has an answer. They are dropped deliberately, not lost.
        for (const entry of movements) {
          if (keep.has(entry.sms)) continue;
          smsLogRepo.record({
            raw: entry.raw,
            fingerprint: fingerprintMessage(entry.raw),
            outcome: 'skipped',
            reason: 'Own-account transfer — not income or spend',
            amountMinor: entry.sms.amountMinor,
            merchant: entry.sms.merchant,
            kind: entry.sms.kind,
            occurredOn: entry.sms.date,
          });
        }

        for (const entry of movements) {
          // A charge cancelled by its reversal — and the reversal itself — are
          // both dropped: no row, no draft, nothing for the user to dismiss.
          if (!keep.has(entry.sms)) continue;

          const result = get().ingestSmsText(entry.raw);

          smsLogRepo.record({
            raw: entry.raw,
            fingerprint: fingerprintMessage(entry.raw),
            outcome: result === 'duplicate' ? 'duplicate' : result === null ? 'ignored' : 'queued',
            reason:
              result === 'duplicate'
                ? 'Already imported earlier'
                : result === null
                  ? 'Not recognised as a transaction'
                  : null,
            amountMinor: entry.sms.amountMinor,
            merchant: entry.sms.merchant,
            kind: entry.sms.kind,
            occurredOn: entry.sms.date,
          });

          if (result === 'duplicate') duplicates++;
          else if (result === null) ignored++;
          else {
            /*
             * Bank fees queue like everything else. NOTHING is created here.
             *
             * Two earlier versions both wrote to the board before the user had
             * agreed to anything: the first confirmed the fee outright (so it
             * vanished from Smart Detect and the user went hunting for a
             * transaction the app had decided not to mention), the second still
             * created the "Bank & fees" category and its line during the drain.
             * Both meant an incoming SMS could add a category to someone's
             * board unprompted.
             *
             * The draft is simply queued. `reconcileSms` proposes the charges
             * line when one already exists, and `confirmDraft` creates it on
             * demand if it does not — so the category appears at the moment the
             * user confirms, and never before.
             */
            queued++;
          }
        }

        /*
         * Hand back only what could not be UNDERSTOOD, so the file keeps it.
         *
         * Everything else is genuinely consumed: a duplicate is already in the
         * table, a cancelled pair was dropped deliberately, and recognised noise
         * is meant to disappear. Returning any of those would make the file
         * never empty — which is both alarming to a user browsing Files and the
         * reason the inbox previously accumulated junk indefinitely.
         */
        return unreadable;
      });

      if (!drained.ok || drained.messages.length === 0) {
        /*
         * Write only on a real change.
         *
         * This path runs on every poll tick (see `watchInbox`), and the file is
         * empty almost every time. An unconditional `set` would publish a new
         * state object every couple of seconds forever, waking every subscriber
         * to re-render an unchanged board.
         */
        if (get().smsInboxWaiting !== 0) set({ smsInboxWaiting: 0 });
        return { ...EMPTY_SUMMARY, deferred: drained.deferred };
      }

      /*
       * Put the empty file back.
       *
       * `drainInbox` deletes it when it takes everything, and Shortcuts' "Append
       * to File" needs an existing target — without this, a working setup would
       * break silently after its very first import, with the automation
       * reporting success and nothing ever arriving.
       *
       * Only when the user has actually set this up, so a device that has never
       * enabled it does not grow a stray file in its Documents folder.
       */
      if (settingsRepo.get(SETTINGS_KEYS.smsInboxEnabled) === 'true') {
        ensureInboxExists();
      }

      set({ smsInboxWaiting: drained.deferred });

      // Recorded BEFORE the reload below, then updated after, so the two views
      // of the queue can be compared — see `lastDrainReport`.
      lastDrainReport = {
        at: Date.now(),
        messages: drained.messages.length,
        queued,
        duplicates,
        ignored,
        pendingRows: smsInboxRepo.pendingCount(),
        draftsInStore: 0,
      };

      /*
       * Republish the queue from the table before returning.
       *
       * `ingestSmsText` calls `loadSmsDrafts` per message, so the common path is
       * already on screen — but only when something was INSERTED. A batch that
       * is entirely duplicates, or whose messages all cancelled as reversal
       * pairs, inserts nothing and would leave the dashboard showing a stale
       * list while the file it came from has just been cleared. Loading here
       * makes "the file emptied" and "the UI updated" the same event on every
       * path, which is the guarantee this feature actually needs.
       *
       * Cheap to repeat: `loadSmsDrafts` publishes only when the queue really
       * changed, so the usual case is a no-op comparison.
       */
      get().loadSmsDrafts();

      // How many drafts the UI actually ended up with. A non-zero `queued` with
      // zero here is the publish bug; matching numbers point at the renderer.
      if (lastDrainReport) lastDrainReport.draftsInStore = get().smsDrafts.length;

      /*
       * Announce the import.
       *
       * Un-awaited: the drafts are already stored and on screen, and a
       * notification must never delay that or fail the import if permission was
       * declined. Only fires when rows were genuinely queued — see
       * `notifyDraftsImported`.
       */
      void notifyDraftsImported(queued);

      return {
        queued,
        duplicates,
        ignored,
        deferred: drained.deferred,
        internalTransfers,
        autoFiled,
      };
    } finally {
      draining = false;
    }
  },

  /**
   * Start reacting to messages that arrive while the app is open.
   *
   * Complements, and cannot replace, the launch/foreground drains: iOS suspends
   * the app in the background, so a message appended while it is closed fires no
   * event and is picked up on the next foreground instead.
   *
   * Returns an unsubscribe function.
   */
  watchSmsInbox() {
    const stopWatching = watchInbox(() => {
      // The guard inside `drainSmsInbox` absorbs the events caused by the
      // drain's own writes to this folder.
      const summary = get().drainSmsInbox();
      if (summary.queued > 0) {
        get().refreshBoard();
        get().refreshMerchantRules();
      }
    });

    /*
     * Drain on every return to the foreground.
     *
     * This is the path that actually matters, and it is separate from the
     * watcher on purpose. Messages arrive while the app is suspended — no timer
     * runs, no filesystem event is delivered — so foregrounding is the first
     * instant anything can see them. Without this, a message that landed while
     * the app sat in the switcher would wait for a full relaunch.
     *
     * `loadSmsDrafts` runs even when the drain imports nothing, so rows left
     * pending from an earlier session are on screen rather than waiting for the
     * queue to change.
     */
    const stopForeground = onForeground(() => get().syncSmsNow());

    return () => {
      stopWatching();
      stopForeground();
    };
  },

  /**
   * One full detection cycle: import, re-pair, re-render.
   *
   * The ordering is the point, and it is why this is one action rather than
   * three calls at each site. `pruneSmsQueue` has to see the whole queue, not
   * just this batch — the two halves of a transfer routinely arrive from the
   * sending and receiving banks in separate imports — and `loadSmsDrafts` runs
   * unconditionally so rows left pending from an earlier session appear even
   * when this drain imported nothing.
   */
  syncSmsNow() {
    const summary = get().drainSmsInbox();
    get().pruneSmsQueue();
    get().loadSmsDrafts();
    // Only a real import changes the board's figures; the queue itself is
    // already re-rendered by `loadSmsDrafts` above.
    if (summary.queued > 0) {
      get().refreshBoard();
      get().refreshMerchantRules();
    }
  },

  confirmDraft(draftId, overrides) {
    const { smsDrafts, period } = get();
    const draft = smsDrafts.find((d) => d.id === draftId);
    if (!draft) return;

    const subcategoryId = overrides?.subcategoryId ?? draft.subcategoryId;
    // Without a target bill there is nothing to mark paid; the confirm card
    // must supply one before this is reachable.
    if (!subcategoryId) return;

    const amountMinor = overrides?.amountMinor ?? draft.amountMinor;
    const target = get().subcategories.find((s) => s.id === subcategoryId);

    if (target && target.frequency === 'unplanned') {
      // An unplanned line accumulates individual entries, so a confirmed SMS
      // becomes one transaction rather than the month's single "actual".
      transactionRepo.create({
        subcategoryId,
        period: draft.parsed.date ? draft.parsed.date.slice(0, 7) : period,
        name: draft.parsed.merchant || 'SMS transaction',
        amountMinor,
        date: draft.parsed.date ? new Date(draft.parsed.date) : new Date(),
        note: overrides?.note ?? draft.parsed.raw,
        houseId: overrides?.houseId ?? null,
      });
    } else {
      stateRepo.logTransaction(subcategoryId, period, {
        status: 'paid',
        actualMinor: amountMinor,
        note: overrides?.note ?? `From SMS: ${draft.parsed.raw}`,
        houseId: overrides?.houseId ?? null,
      });
    }

    // Learn from the resolution. Whether the user accepted our guess or picked
    // a different line, the merchant now has a confirmed mapping — so the next
    // message from the same shop is recognised outright. Correcting a wrong
    // guess re-points the existing rule, which is how accuracy improves.
    const upsert = planRuleUpsert(
      draft.parsed.merchant,
      subcategoryId,
      draft.hint,
      get().merchantRules,
    );
    if (upsert) merchantRuleRepo.apply(upsert);

    /*
     * Resolve the stored row as well as the in-memory list.
     *
     * A draft's id IS its `sms_inbox` row id (see `loadSmsDrafts`), so this
     * settles the queue durably. Without it the row would stay `pending` and the
     * draft would come back the next time the queue is loaded — already logged,
     * and offered for logging again.
     */
    smsInboxRepo.resolve(draftId, 'confirmed');
    set({ smsDrafts: smsDrafts.filter((d) => d.id !== draftId) });
    // Board (the logged payment) and rules (the merchant mapping just learned
    // above) — settings and mini-app tables cannot have changed here.
    get().refreshBoard();
    get().refreshMerchantRules();

    // Share this resolution with the catalog. Un-awaited and failure-swallowing:
    // confirming a draft must feel instant and must never fail because a network
    // call did.
    void get().contributeDraft(draft, subcategoryId);
  },

  dismissDraft(draftId) {
    // Kept as a `dismissed` row rather than deleted, so its fingerprint still
    // rejects the same message if the automation delivers it again.
    smsInboxRepo.resolve(draftId, 'dismissed');
    set({ smsDrafts: get().smsDrafts.filter((d) => d.id !== draftId) });
  },
});
