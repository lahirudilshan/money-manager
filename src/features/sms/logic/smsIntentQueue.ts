/**
 * The queue the "Send Message to Dayly" Shortcuts action writes into.
 *
 * The native App Intent (plugins/ios/SendMessageToDaylyIntent.swift) runs in the
 * background and writes each bank alert as its OWN file under
 * Documents/.sms-intake — one atomic file per message. That shape is what makes
 * this intake dependable where the older ones were not:
 *
 *   - nothing is appended to a shared file, so the app's drain can never race
 *     the automation and lose a message mid-rewrite;
 *   - one file is one message, so there is no separator to get wrong and two
 *     alerts can never run together;
 *   - the folder is the app's own, so no Shortcuts folder bookmark exists to go
 *     stale after a reinstall.
 *
 * The leading dot hides the folder from the Files app: unlike the old inbox
 * file, there is nothing here for the user to find or look after.
 *
 * Files are deleted only AFTER their message is durably stored (see
 * `drainInbox`), so a crash mid-import replays rather than loses.
 */

import { Directory, File, Paths } from 'expo-file-system';

/** Shared with `DaylyMessageQueue.folderName` in the Swift intent. */
export const INTENT_QUEUE_DIR = '.sms-intake';

/** One message waiting in the queue, with the file to delete once it is stored. */
export interface QueuedIntentMessage {
  text: string;
  file: File;
}

function queueDir(): Directory {
  return new Directory(Paths.document, INTENT_QUEUE_DIR);
}

/**
 * Arrival order from the file name: the intent prefixes each one with the
 * epoch milliseconds it was written at.
 */
export function intentFileOrder(name: string): number {
  const millis = Number(name.split('-')[0]);
  return Number.isFinite(millis) ? millis : Number.MAX_SAFE_INTEGER;
}

/** Every message the Shortcuts action has handed over, oldest first. */
export function readIntentQueue(): QueuedIntentMessage[] {
  try {
    const dir = queueDir();
    if (!dir.exists) return [];

    const files = dir
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.txt'))
      .sort((a, b) => intentFileOrder(a.name) - intentFileOrder(b.name));

    const messages: QueuedIntentMessage[] = [];
    for (const file of files) {
      try {
        const text = file.textSync().trim();
        if (text.length > 0) messages.push({ text, file });
        else file.delete(); // an empty run of the action carries nothing
      } catch {
        // Unreadable right now (mid-write); the next poll picks it up.
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/** How many messages are waiting, without consuming them. */
export function countIntentQueue(): number {
  return readIntentQueue().length;
}

/** Remove files whose messages have been stored. Never throws. */
export function clearIntentMessages(done: readonly QueuedIntentMessage[]): void {
  for (const { file } of done) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Left for the next drain; the fingerprint index absorbs the replay.
    }
  }
}
