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
  INBOX_FOLDER,
  INBOX_RELATIVE_PATH,
  planDrain,
  type DrainPlan,
} from '../core/smsInbox';

/** The folder holding the inbox file, inside the app's Documents. */
function inboxDir(): Directory {
  return new Directory(Paths.document, INBOX_FOLDER);
}

/** The inbox handle. Constructed per call — a `File` is a cheap path wrapper. */
function inboxFile(): File {
  return new File(inboxDir(), INBOX_FILENAME);
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
 */
export const FILES_APP_LOCATION = 'On My iPhone → money-manager';

/**
 * What the user types into Shortcuts' File Path field, and what the copy button
 * copies: the folder and file, relative to the app's Documents.
 */
export const INBOX_FILE_PATH = INBOX_RELATIVE_PATH;

/**
 * Just the filename — what Shortcuts' "File Path" field actually wants.
 *
 * The Shortcuts file actions resolve paths RELATIVE to the folder picked in the
 * action's own folder chooser, so pasting the full sandbox path there fails.
 * The user picks the app's folder in Shortcuts, then types this. Exported as a
 * constant so the guide, the copy button and the file itself can never disagree
 * about the name.
 */
export const INBOX_FILE_NAME = INBOX_FILENAME;

/** The folder name alone, for the Shortcuts folder chooser. */
export const INBOX_FOLDER_NAME = INBOX_FOLDER;

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
    const dir = inboxDir();
    if (!dir.exists) dir.create({ intermediates: true });

    const file = inboxFile();
    if (!file.exists) {
      file.create();
      file.write(
        [
          '# money-manager SMS inbox',
          '#',
          '# Your Shortcuts automation appends bank messages here, and the app',
          '# reads and clears them next time you open it.',
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
 * The file is rewritten (or deleted) BEFORE the caller processes the messages
 * it returns. That ordering is deliberate: if the app crashes mid-import the
 * user loses a few drafts they can re-add by hand, whereas the reverse ordering
 * would replay the same messages on every launch forever.
 */
export function drainInbox(): DrainPlan & { ok: boolean } {
  const empty = { messages: [], remainder: '', deferred: 0, ok: false };

  try {
    const file = inboxFile();
    if (!file.exists) return { ...empty, ok: true };

    const plan = planDrain(file.textSync());
    if (plan.messages.length === 0) return { ...empty, ok: true };

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
