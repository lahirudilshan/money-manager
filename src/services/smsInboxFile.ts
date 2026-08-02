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
} from '../core/smsInbox';

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
         * The seed header is itself a record as far as `planDrain` is concerned
         * (that is deliberate — the SMS parser ignores it later), so counting
         * records would treat an enabled-but-never-used inbox as having content
         * and copy the header into a file that already has one. Records made up
         * entirely of `#` comment lines are therefore dropped here.
         */
        const carried = planDrain(legacyFile.textSync(), Number.MAX_SAFE_INTEGER)
          .messages.filter((record) =>
            record.split('\n').some((line) => !line.trim().startsWith('#')),
          )
          .join(`\n${RECORD_SEPARATOR}\n`);

        if (carried.length > 0) {
          const target = inboxFile();
          const existing = target.exists ? target.textSync().trimEnd() : '';
          target.write(
            existing.length > 0 ? `${existing}\n${RECORD_SEPARATOR}\n${carried}\n` : `${carried}\n`,
          );
        }

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
 * Create the inbox file if it does not exist.
 *
 * Called when the user turns the feature on. The file must EXIST before
 * Shortcuts can be pointed at it — an automation targeting a missing file
 * fails with an error the user cannot diagnose — and an empty file is also what
 * makes the folder appear in the Files app, since iOS hides an empty container.
 *
 * The seed comment doubles as a header the user sees if they open the file, and
 * `parseInbox` treats it as an ordinary record that the SMS parser then ignores,
 * so it costs nothing.
 */
export function ensureInboxExists(): { ok: boolean; path: string; error?: string } {
  try {
    const file = inboxFile();
    if (!file.exists) {
      file.create();
      file.write(
        [
          '# money-manager SMS inbox — TEMPORARY HANDOFF FILE',
          '#',
          '# Your Shortcuts automation appends bank messages here. The app moves',
          '# each one into its database and empties this file, so seeing it empty',
          '# means everything has been imported — nothing is stored here.',
          '#',
          '# Separate messages with a line containing only three dashes.',
          '',
        ].join('\n'),
      );
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
 */
export function drainInbox(commit: (messages: string[]) => void): DrainPlan & { ok: boolean } {
  const empty = { messages: [], remainder: '', deferred: 0, ok: false };

  try {
    const file = inboxFile();
    if (!file.exists) return { ...empty, ok: true };

    const plan = planDrain(file.textSync());
    if (plan.messages.length === 0) return { ...empty, ok: true };

    // Durably stored first — see above. A throw here leaves the file intact.
    commit(plan.messages);

    if (plan.remainder) {
      file.write(plan.remainder);
    } else {
      // Deleted rather than emptied, so a user browsing Files sees the queue is
      // clear. `ensureInboxExists` recreates it on the next enable, and the
      // Shortcuts "Append to File" action recreates it on the next message.
      file.delete();
    }

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
  try {
    const subscription = inboxDir().watch(() => onChange());
    return () => {
      try {
        subscription.remove();
      } catch {
        // Already torn down by the platform; nothing to release.
      }
    };
  } catch {
    return () => {};
  }
}

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
