/**
 * The inbox file itself: create, read, rewrite, delete.
 *
 * Lives in the app's Documents folder, which iOS exposes in the Files app under
 * "On My iPhone > money-manager" once `UIFileSharingEnabled` and
 * `LSSupportsOpeningDocumentsInPlace` are set (see app.json). Both are needed:
 * the first makes the folder visible, and WITHOUT the second Shortcuts writes to
 * a sandboxed copy it can append to forever while the app sees nothing.
 *
 * Those keys only take effect after a NATIVE REBUILD. On a build that predates
 * them the folder is invisible in Files, so `isInboxAvailable` reports that and
 * the UI explains it rather than showing a path the user cannot find.
 *
 * Every function here is defensive: this file is written by an automation the
 * user assembled themselves, so it may be missing, empty, half-written, or
 * full of something that is not a bank message.
 */

import { Directory, File, Paths } from 'expo-file-system';
import {
  INBOX_FILENAME,
  INBOX_RELATIVE_PATH,
  planDrain,
  RECORD_SEPARATOR,
  type DrainPlan,
} from '~/features/sms/logic/smsInbox';

/**
 * The folder holding the inbox file: the app's Documents root.
 *
 * Named rather than inlined because the watcher needs the same directory the
 * file sits in — it watches the FOLDER, not the file (see `watchInbox`).
 */
function inboxDir(): Directory {
  return Paths.document;
}

/** The inbox handle. Constructed per call — a `File` is a cheap path wrapper. */
function inboxFile(): File {
  return new File(inboxDir(), INBOX_FILENAME);
}

/**
 * Every place the inbox has previously lived, as `[folder, filename]`.
 *
 * `null` folder means Documents' root. Ordered oldest first, though the order
 * does not matter — each is drained into the current file in turn.
 *
 * Kept only so `migrateLegacyInbox` can recover messages from a device set up by
 * an earlier build. Nothing else may reference these.
 */
const LEGACY_INBOX_LOCATIONS: [folder: string | null, filename: string][] = [
  ['money-manager', 'sms-inbox.txt'],
  ['files', 'sms-inbox.txt'],
  // Same folder as today, but the pre-"temp-" name.
  [null, 'sms-inbox.txt'],
];

/**
 * Carry an inbox from any previous location over to the current one.
 *
 * A device set up by an earlier build has its Shortcut pointed at an older path
 * and may have messages queued there that were never drained. Dropping those
 * would silently lose real transactions, so each old file's contents are
 * APPENDED to the current inbox (the drain is order-tolerant, and appending
 * cannot clobber anything the automation has already written to the new path).
 *
 * Old files are deleted afterwards so this is a one-time move, and an emptied
 * folder goes with them so the user does not browse Files and find several
 * folders that look like they all matter. Failures are swallowed: this is a
 * best-effort tidy-up on paths the user may never have had, and it must never
 * stop the app from starting.
 *
 * NOTE: this does not re-point the user's Shortcut — nothing can, from here.
 * The automation still writes to the old path until they update it, which is
 * why the settings screen has to tell them the path changed.
 */
export function migrateLegacyInbox(): void {
  for (const [folder, filename] of LEGACY_INBOX_LOCATIONS) {
    try {
      const legacyDir = folder === null ? Paths.document : new Directory(Paths.document, folder);
      if (!legacyDir.exists) continue;

      const legacyFile = new File(legacyDir, filename);
      // `folder === null` shares a directory with the live inbox, so guard
      // against a rename that would otherwise read and delete the current file.
      if (legacyFile.uri === inboxFile().uri) continue;

      if (legacyFile.exists) {
        /*
         * Carry only real messages.
         *
         * `parseInbox` strips `#` comment lines and drops records left empty, so
         * a legacy file holding nothing but its seed header yields no messages
         * and nothing is copied — an enabled-but-never-used inbox does not
         * append a second header to the current file.
         */
        const carried = planDrain(legacyFile.textSync(), Number.MAX_SAFE_INTEGER).messages.join(
          `\n${RECORD_SEPARATOR}\n`,
        );

        if (carried.length > 0) {
          const target = inboxFile();
          const existing = target.exists ? target.textSync().trimEnd() : '';
          target.write(
            existing.length > 0 ? `${existing}\n${RECORD_SEPARATOR}\n${carried}\n` : `${carried}\n`,
          );
        }

        /*
         * These deletes are the exception to "never delete the inbox", and they
         * are safe because they target ABANDONED paths, not the live one.
         *
         * A file at an old path is one nothing writes to any more: its messages
         * have just been copied across, and leaving it would show the user two
         * inbox files and invite them to point Shortcuts at the dead one. The
         * live file at the current path is only ever truncated (see
         * `drainInbox`), so no bookmark that still matters is invalidated here.
         */
        legacyFile.delete();
      }

      // Only removes it when empty, and never Documents itself, so nothing the
      // user parked there is destroyed.
      if (folder !== null && legacyDir.list().length === 0) legacyDir.delete();
    } catch {
      // Best-effort per location: one unreadable path must not stop the others.
    }
  }
}

/**
 * The path to show the user, and to put on their clipboard.
 *
 * `file://` is stripped: this string is pasted into a Shortcuts "File Path"
 * field, which wants a plain path, and it is also what the user reads to find
 * the file in the Files app.
 */
export function inboxPath(): string {
  return inboxFile().uri.replace(/^file:\/\//, '');
}

/**
 * The folder name as it appears in the Files app.
 *
 * Shown in the setup steps because the full sandbox path is a UUID soup nobody
 * can navigate by eye — the user needs "On My iPhone > money-manager", not
 * /var/mobile/Containers/Data/Application/A1B2.../Documents.
 *
 * This is the APP's folder — iOS names it after the app — and the inbox file
 * sits directly inside it, so this is also the folder the user picks in the
 * Shortcuts folder chooser.
 */
export const FILES_APP_LOCATION = 'On My iPhone → money-manager';

/**
 * What the user types into Shortcuts' File Path field, and what the copy button
 * copies.
 *
 * The Shortcuts file actions resolve paths RELATIVE to the folder picked in the
 * action's own folder chooser, so pasting the full sandbox path there fails.
 * The user picks the app's folder in Shortcuts, then types this — which, now
 * that the inbox sits in Documents' root, is simply the filename.
 */
export const INBOX_FILE_PATH = INBOX_RELATIVE_PATH;

/**
 * The header a drained inbox is left holding.
 *
 * Defined once because two places write it — creation and the post-drain
 * truncate — and a drain that wrote different text would leave the user with a
 * file whose instructions drift from the one the setup guide describes.
 *
 * `parseInbox` treats it as an ordinary record that the SMS parser then ignores,
 * so it costs nothing to keep at the top of the file forever.
 */
const SEED_HEADER = [
  '# money-manager SMS inbox — TEMPORARY HANDOFF FILE',
  '#',
  '# Your Shortcuts automation appends bank messages here. The app moves',
  '# each one into its database and clears them from this file, so seeing',
  '# only these lines means everything has been imported.',
  '#',
  // The braces ARE written literally, unlike the old dash separator: they only
  // delimit a record when they enclose text, so an empty pair in a comment
  // costs nothing, and showing the exact shape is what makes the instruction
  // followable. The dash separator is still described rather than printed —
  // `parseInbox` splits on three-or-more dashes anywhere, so spelling it out
  // would cut the header in half and leave a phantom record after every drain.
  '# Wrap EACH message in curly braces, like this:',
  '#',
  '#   {the whole message text}',
  '#   {the next message}',
  '#',
  '# The braces mark where each message starts AND ends, so two messages can',
  '# never run together and be read as one wrong amount. Older shortcuts that',
  '# end each message with three dashes still work.',
  '',
].join('\n');

/**
 * Create the inbox file if it does not exist.
 *
 * Called when the user turns the feature on. The file must EXIST before
 * Shortcuts can be pointed at it — an automation targeting a missing file
 * fails with an error the user cannot diagnose — and an empty file is also what
 * makes the folder appear in the Files app, since iOS hides an empty container.
 */
export function ensureInboxExists(): { ok: boolean; path: string; error?: string } {
  try {
    const file = inboxFile();
    if (!file.exists) {
      file.create();
      file.write(SEED_HEADER);
    }

    return { ok: true, path: inboxPath() };
  } catch (error) {
    return { ok: false, path: '', error: String(error) };
  }
}

/** Whether the inbox file currently exists. */
export function inboxExists(): boolean {
  try {
    return inboxFile().exists;
  } catch {
    return false;
  }
}

/**
 * How many messages are waiting, without consuming them.
 *
 * Used by the Smart Detect screen to show a count before the user drains, so
 * "3 waiting" is visible rather than the user having to trigger a drain to find
 * out whether their automation works at all.
 */
export function countWaiting(): number {
  try {
    const file = inboxFile();
    if (!file.exists) return 0;
    return planDrain(file.textSync(), Number.MAX_SAFE_INTEGER).messages.length;
  } catch {
    return 0;
  }
}

/** What the app actually sees at the inbox path, for the diagnostics panel. */
export interface InboxDiagnostics {
  /** The absolute path the app reads. Compare against what Shortcuts writes. */
  path: string;
  exists: boolean;
  /** Raw byte length. Zero on a file that exists but was never written. */
  bytes: number;
  /** Records `parseInbox` finds — after comment stripping. */
  records: number;
  /** First 200 characters, so the header/message shape is visible. */
  preview: string;
  /**
   * The file holds the seed header and NOTHING else.
   *
   * The single most diagnostic state this feature has. It means the app's own
   * file is untouched since creation while the user can see their message in
   * the Files app — so Shortcuts is appending to a different file, almost
   * always a stale folder bookmark pointing at a previous install's container
   * (the `Application/<UUID>` path changes on every reinstall). Nothing the app
   * can read will ever contain those messages: iOS forbids reaching another
   * container. Only re-picking the folder inside the Shortcut fixes it.
   */
  headerOnly: boolean;
  /** Set when reading threw, e.g. a sandbox permission problem. */
  error?: string;
}

/**
 * Report the inbox file's real state.
 *
 * Exists because every failure in this feature looks identical from the UI —
 * "the file emptied and nothing appeared" — and the difference between "the app
 * reads a different path than Shortcuts writes", "the file is there but empty",
 * and "it has content the parser rejects" is invisible without looking. Each
 * needs a completely different fix, so guessing between them costs a rebuild
 * cycle every time.
 *
 * Deliberately reads the file rather than trusting cached state: the whole point
 * is to see what is on disk right now.
 */
export function inboxDiagnostics(): InboxDiagnostics {
  const base: InboxDiagnostics = {
    path: '',
    exists: false,
    bytes: 0,
    records: 0,
    preview: '',
    headerOnly: false,
  };

  try {
    const file = inboxFile();
    const path = inboxPath();

    if (!file.exists) return { ...base, path };

    const text = file.textSync();

    return {
      path,
      exists: true,
      bytes: text.length,
      records: planDrain(text, Number.MAX_SAFE_INTEGER).messages.length,
      preview: text.slice(0, 200),
      // Compared against the constant rather than by length, so an edited or
      // partially-written file is not mistaken for a pristine one.
      headerOnly: text.trim() === SEED_HEADER.trim(),
    };
  } catch (error) {
    return { ...base, error: String(error) };
  }
}

/**
 * Take the waiting messages, leaving anything above the cap in place.
 *
 * `commit` is handed the batch and MUST durably store it; the file is cleared
 * only after it returns. This ordering is the opposite of the original design,
 * and the reason it changed is that the queue is now a database table:
 *
 *   - clearing first meant a crash mid-import destroyed messages outright,
 *     because nothing had persisted them yet — the drafts lived in memory;
 *   - clearing last means a crash simply replays the batch on the next launch,
 *     and `sms_inbox.fingerprint` (unique) absorbs the repeat.
 *
 * So the failure mode moved from "silently lose real transactions" to "do
 * harmless work twice", which is the trade that was unavailable before.
 *
 * If `commit` throws, the file is left completely untouched and `ok` is false —
 * the batch is retried whole rather than half-consumed.
 *
 * THE FILE IS NEVER DELETED, only rewritten. It used to be removed once empty,
 * which broke the very thing it exists for: iOS grants Shortcuts a
 * security-scoped bookmark to a specific file, and deleting that file
 * invalidates the bookmark — so the automation asks for folder permission again
 * on the next run, over and over. Recreating it a moment later does not help,
 * because the new file is a different inode. Truncating in place keeps one
 * stable identity for the bookmark's lifetime, and closes the window where the
 * file does not exist and an appending Shortcut would fail.
 */
export function drainInbox(
  commit: (messages: string[]) => string[] | void,
): DrainPlan & { ok: boolean } {
  const empty = { messages: [], remainder: '', deferred: 0, ok: false };

  try {
    const file = inboxFile();
    if (!file.exists) return { ...empty, ok: true };

    const plan = planDrain(file.textSync());
    if (plan.messages.length === 0) return { ...empty, ok: true };

    // Durably stored first — see above. A throw here leaves the file intact.
    const unconsumed = commit(plan.messages) ?? [];

    /*
     * Rewrite in place: the header, anything the cap deferred, and anything
     * `commit` could not consume.
     *
     * That last group is the reason this returns a value at all. A message the
     * parser does not recognise stores NO row, so clearing it destroyed the
     * only copy — the user watched their SMS disappear from the Files app with
     * nothing arriving in the app and no way to recover the text. Keeping it
     * means a parser gap is a message still sitting in the file, which is
     * visible, reportable, and fixed retroactively the moment the parser learns
     * that format.
     *
     * The header goes back every time so the file is never zero bytes — an
     * empty file reads as "something went wrong" to anyone who opens it, and
     * these lines are what explain that an empty queue is the healthy state.
     */
    const kept = [...unconsumed, plan.remainder].filter((part) => part.length > 0);

    file.write(
      kept.length > 0
        ? `${SEED_HEADER}${RECORD_SEPARATOR}\n${kept.join(`\n${RECORD_SEPARATOR}\n`)}\n`
        : SEED_HEADER,
    );

    return { ...plan, ok: true };
  } catch {
    return empty;
  }
}

/**
 * Call `onChange` whenever the inbox file may have changed.
 *
 * Watches the FOLDER, not the file, which is the only thing that works here: a
 * file watcher is a `DispatchSource` bound to one inode, and expo-file-system
 * tears it down on delete or rename. Since a completed drain deletes the file,
 * a file watcher would fire exactly once and then stay silent forever — the
 * same invisible failure this feature has already suffered from once.
 *
 * The event is treated as "something happened, go and look" rather than being
 * inspected: iOS directory watchers only report that the directory changed, so
 * `event.type` cannot be trusted to distinguish a new message from the drain's
 * own write.
 *
 * That last point is also why the caller must guard re-entry — this fires again
 * for the writes the drain itself performs.
 *
 * The watched folder is now Documents' root, so unrelated activity there can
 * also wake this. That costs a read of a file that is usually empty, which is
 * cheap, and the drain's own guard absorbs the rest.
 *
 * Returns an unsubscribe function. Never throws: on a platform or build where
 * watching is unavailable, the app still drains on launch and foreground, so
 * this degrades to "not live" rather than breaking.
 */
export function watchInbox(onChange: () => void): () => void {
  const stops: (() => void)[] = [];

  try {
    const subscription = inboxDir().watch(() => onChange());
    stops.push(() => {
      try {
        subscription.remove();
      } catch {
        // Already torn down by the platform; nothing to release.
      }
    });
  } catch {
    // No watcher on this platform or build — the poll below still delivers.
  }

  /*
   * A poll alongside the watcher, because the watcher alone is not dependable.
   *
   * `DispatchSource` events are delivered to a RUNNING app. Messages arrive
   * while the app is backgrounded or the phone is locked — precisely when iOS
   * has suspended it — and an event that fires against a suspended process is
   * not queued for later. Observed directly: a file written while the app was
   * launched-but-not-foreground was never drained until a relaunch.
   *
   * `AppState` foregrounding covers the common case, but not "app is open on
   * screen and a message lands", which is the one the user experiences as
   * real-time. A cheap timer covers exactly that gap: it only reads a file that
   * is almost always empty, and the drain's own re-entrancy guard absorbs the
   * overlap when both the watcher and the tick fire for the same write.
   */
  const timer = setInterval(onChange, POLL_INTERVAL_MS);
  stops.push(() => clearInterval(timer));

  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * How often to check the inbox while the app is open.
 *
 * Two seconds is under the threshold where a person notices a delay, and the
 * check itself is a stat plus a short read of a file that is usually empty —
 * far cheaper than the render it would trigger. iOS suspends timers in the
 * background, so this costs nothing while the app is not in use.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Whether the Files app can actually see the inbox on THIS build.
 *
 * The Documents folder always exists, but it only appears in Files after a
 * native rebuild with the two Info.plist keys. There is no runtime API to read
 * them back, so this reports what can be checked — that the file exists and is
 * writable — and the UI is written to explain the rebuild requirement rather
 * than promise the folder is visible.
 */
export function isInboxAvailable(): boolean {
  try {
    return new Directory(Paths.document).exists;
  } catch {
    return false;
  }
}
