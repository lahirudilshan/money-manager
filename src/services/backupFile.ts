/**
 * Writing and reading backup files on the device.
 *
 * ## Why files, and why this folder
 *
 * Backups land in the app's Documents folder — the same one the SMS intake
 * uses — which iOS exposes in the Files app under "On My iPhone >
 * money-manager" (see `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace`
 * in app.json). That single fact is what makes this useful without any cloud
 * integration at all: from the Files app the user can move a backup into Google
 * Drive, iCloud, or anywhere else, with the system share sheet doing the work.
 *
 * That matters because Drive's own API needs OAuth, which needs
 * `expo-auth-session` — a native dependency requiring a rebuild. The protocol
 * layer for it is written and tested (core/driveSync.ts), but this path works
 * on the build the user is running today, and it keeps the data in the user's
 * hands rather than routing it through a server.
 *
 * ## The folder is shared with the SMS inbox
 *
 * Deliberately. Two folders would mean two places for the user to look, and the
 * inbox file is named `temp-` precisely so it reads as transient next to
 * something like `money-manager-2026-08-04.json` that plainly is not.
 */

import { Directory, File, Paths } from 'expo-file-system';
import {
  describeSnapshot,
  isSnapshotFilename,
  parseSnapshot,
  serialiseSnapshot,
  snapshotFilename,
  type Snapshot,
} from '../core/backup';

/** Where backups live: the app's Documents root, visible in the Files app. */
function backupDir(): Directory {
  return Paths.document;
}

/** What a save attempt produced, for the message the user sees. */
export interface SaveResult {
  ok: boolean;
  /** The filename written, so the UI can name it. */
  filename?: string;
  /** Absolute path, for the "where is it" line. */
  path?: string;
  error?: string;
}

/**
 * Write a snapshot to a new timestamped file.
 *
 * Never overwrites: `snapshotFilename` is timestamped to the second, so each
 * save is a distinct restore point. A backup that replaces the previous one
 * with a corrupt copy is not a backup, and the user's Documents folder is not
 * short of space at a few hundred KB per file.
 */
export function saveBackup(snapshot: Snapshot): SaveResult {
  try {
    const filename = snapshotFilename(new Date(snapshot.createdAt));
    const file = new File(backupDir(), filename);

    file.create();
    file.write(serialiseSnapshot(snapshot));

    return { ok: true, filename, path: file.uri.replace(/^file:\/\//, '') };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** A backup found on the device. */
export interface StoredBackup {
  filename: string;
  /** Bytes, for the size shown beside it. */
  size: number;
  /** When it was written, parsed from the filename rather than the filesystem. */
  createdAt: string;
  /**
   * What the file actually holds — "10 bills · 42 transactions".
   *
   * Read at list time rather than left to the restore confirmation, because
   * "1 KB" is not a basis for choosing between two restore points. A user
   * picking which backup to go back to needs to know what is IN them, and
   * finding out only after tapping Restore is too late to be useful.
   *
   * Empty when the file could not be read — the row still lists, so a damaged
   * backup is visible and deletable rather than silently missing.
   */
  summary: string;
  /** The user's own name for it, when they gave one. */
  label?: string;
}

/**
 * List the backups in the folder, newest first.
 *
 * Ordered by FILENAME rather than by a filesystem timestamp: the name carries
 * the moment the snapshot was taken, while a file's mtime changes if it is
 * copied back from Drive, which would silently reorder the list and put an old
 * restore point on top.
 */
export function listBackups(): StoredBackup[] {
  try {
    const entries = backupDir().list();

    const backups: StoredBackup[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (!isSnapshotFilename(name)) continue;

      const file = new File(backupDir(), name);
      backups.push({
        filename: name,
        size: file.size ?? 0,
        // "money-manager-2026-08-04T12-00-00.json" -> the timestamp portion.
        createdAt: name.replace(/^money-manager-/, '').replace(/\.json$/i, ''),
        ...readMeta(file),
      });
    }

    return backups.sort((a, b) => b.filename.localeCompare(a.filename));
  } catch {
    return [];
  }
}

/**
 * A one-line description of a file's contents, or '' when unreadable.
 *
 * Deliberately failure-tolerant: a corrupt backup must still LIST, so the user
 * can see it exists and delete it, rather than vanishing from the screen and
 * leaving them wondering where it went.
 */
function readMeta(file: File): { summary: string; label?: string } {
  try {
    const snapshot = parseSnapshot(file.textSync());
    if (!snapshot) return { summary: '' };

    return {
      summary: describeSnapshot(snapshot),
      ...(snapshot.label ? { label: snapshot.label } : {}),
    };
  } catch {
    return { summary: '' };
  }
}

/**
 * Read one backup back.
 *
 * Returns null rather than throwing for every failure mode — missing,
 * unreadable, not JSON — because the caller's next step is identical in each
 * case: tell the user this file cannot be restored. `validateSnapshot` then
 * decides whether the CONTENT is sound.
 */
export function readBackup(filename: string): Snapshot | null {
  try {
    const file = new File(backupDir(), filename);
    if (!file.exists) return null;

    return parseSnapshot(file.textSync());
  } catch {
    return null;
  }
}

/** Delete a backup the user no longer wants. */
export function deleteBackup(filename: string): boolean {
  try {
    const file = new File(backupDir(), filename);
    if (!file.exists) return false;
    file.delete();
    return true;
  } catch {
    return false;
  }
}

/**
 * The folder name as it appears in the Files app.
 *
 * Shown in the UI because the full sandbox path is a UUID nobody can navigate
 * by eye — the user needs "On My iPhone > money-manager", which is also where
 * they long-press a backup to share it into Drive.
 */
export const BACKUP_FILES_LOCATION = 'On My iPhone → money-manager';
