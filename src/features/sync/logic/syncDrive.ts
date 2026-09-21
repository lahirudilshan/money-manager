/**
 * Two phones, one Drive file, no server.
 *
 * ## The shape of it
 *
 * Every paired device reads the same file out of the user's own Drive folder,
 * merges it with its local rows, and writes the result back. There is no
 * server holding state and no account system: the file id IS the pairing, and
 * both phones sign into the same Google account that already backs the app up.
 *
 *   download  ->  merge  ->  prune  ->  upload
 *
 * ## Why merge rather than restore
 *
 * The obvious implementation — upload a snapshot, restore it on the other
 * phone — silently destroys data: `restoreSnapshot` clears each table first, so
 * whichever device uploads last erases the other's day. `mergeTables` keeps the
 * newer of each ROW instead, so two people adding different things both keep
 * theirs. See features/sync/logic/merge.ts.
 *
 * ## What this deliberately does not do
 *
 * No background sync, no push. A sync happens when the user opens the screen or
 * taps the button. Drive has no change notifications, so "always on" would mean
 * polling Google on a timer forever — battery and quota spent on a household of
 * two who both know when they have just added something.
 */

import {
  createSyncFileRequest,
  findSyncFileRequest,
  parseSyncFileId,
  updateSyncFileRequest,
} from '~/features/backup/logic/driveSync';
import { applyMerged, exportForSync } from '~/features/backup/logic/backupRepo';
import { describeMerge, mergeTables, pruneTombstones } from './merge';

/** What a sync did, in the words the screen shows. */
export interface SyncResult {
  ok: boolean;
  /** Rows that arrived from the other device. */
  pulled: number;
  /** Rows this device contributed. */
  pushed: number;
  /** Rows both had, where the older version was discarded. */
  conflicts: number;
  /** ISO timestamp of the sync, for the "last synced" line. */
  at?: string;
  error?: string;
  /** True when the Google account needs reconnecting. */
  signedOut?: boolean;
}

/**
 * The Drive plumbing this module needs, passed in rather than imported.
 *
 * `googleDrive.ts` owns the token refresh and the folder lookup, and both touch
 * the secure store — which does not exist under vitest. Injecting them keeps
 * every decision in this file testable with a fake, and leaves the real module
 * as the only place that talks to the network.
 */
export interface DriveGateway {
  /** A valid access token, or null when the account must sign in again. */
  token(): Promise<string | null>;
  /** The app's Drive folder id, creating it if needed. */
  folder(token: string): Promise<string | null>;
  /** Run a prepared request and return its parsed JSON, or null on failure. */
  send(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<unknown>;
  /** Fetch a file's raw contents by id. */
  download(fileId: string): Promise<{ ok: boolean; contents?: string; error?: string }>;
}

/** Where the shared file lives, once found. Stored so the next sync is direct. */
export interface SyncState {
  fileId: string | null;
}

/**
 * Run one sync.
 *
 * Returns a result rather than throwing: every failure here is something the
 * user can act on — reconnect, check the connection, try again — and an
 * exception would strand the screen with a spinner and no explanation.
 */
export async function runSync(
  drive: DriveGateway,
  state: SyncState,
  now = Date.now(),
): Promise<SyncResult & { fileId?: string }> {
  const empty = { pulled: 0, pushed: 0, conflicts: 0 };

  const token = await drive.token();
  if (!token) {
    return {
      ok: false,
      ...empty,
      signedOut: true,
      error: 'Sign in to Google again to sync.',
    };
  }

  const folder = await drive.folder(token);
  if (!folder) {
    return { ok: false, ...empty, error: 'Could not open the money-manager folder in Drive.' };
  }

  /*
   * The local rows are read ONCE, before any network call.
   *
   * Reading after the download would widen the window in which the user can
   * change something that then gets merged against a file fetched before the
   * change — the row would upload, but the merge report would be wrong about
   * what moved.
   */
  const mine = exportForSync();

  // Find the shared file. A cached id skips the lookup on every sync after the
  // first; a stale one falls back to searching by name.
  let fileId = state.fileId;
  if (!fileId) {
    const found = await drive.send(findSyncFileRequest(token, folder));
    fileId = parseSyncFileId(found);
  }

  /*
   * No file yet: this device is the first to sync. Its own rows become the
   * shared state — there is nothing to merge against, and an empty file would
   * be indistinguishable from "the other phone deleted everything".
   */
  if (!fileId) {
    const contents = JSON.stringify(pruneTombstones(mine, now));
    const created = await drive.send(createSyncFileRequest(token, folder, contents));
    const newId = parseSyncFileId({ files: [created] }) ?? idOf(created);
    if (!newId) {
      return { ok: false, ...empty, error: 'Could not create the sync file in Drive.' };
    }
    return {
      ok: true,
      pulled: 0,
      pushed: countRows(mine),
      conflicts: 0,
      at: new Date(now).toISOString(),
      fileId: newId,
    };
  }

  const downloaded = await drive.download(fileId);
  if (!downloaded.ok || !downloaded.contents) {
    return { ok: false, ...empty, error: downloaded.error ?? 'Could not read the sync file.' };
  }

  const theirs = parseSyncFile(downloaded.contents);
  if (!theirs) {
    /*
     * A corrupt file is NOT overwritten.
     *
     * Uploading over it would destroy whatever the other device last wrote, on
     * the strength of a parse failure that might be a truncated download.
     */
    return {
      ok: false,
      ...empty,
      error: 'The sync file could not be read. It was left untouched.',
    };
  }

  const report = describeMerge(mine, theirs);
  const merged = mergeTables(mine, theirs);

  // Write the other device's rows locally BEFORE uploading: if the upload then
  // fails, this phone still gained what the other had, and the next sync
  // re-sends its own rows.
  const applied = applyMerged(merged);
  if (!applied.ok) {
    return { ok: false, ...empty, error: applied.error ?? 'Could not save the merged data.' };
  }

  const contents = JSON.stringify(pruneTombstones(merged, now));
  const uploaded = await drive.send(updateSyncFileRequest(token, fileId, contents));
  if (!uploaded) {
    return {
      ok: false,
      pulled: report.pulled,
      pushed: 0,
      conflicts: report.conflicts,
      error: 'Saved their changes here, but could not upload yours. Try again.',
    };
  }

  return {
    ok: true,
    pulled: report.pulled,
    pushed: report.pushed,
    conflicts: report.conflicts,
    at: new Date(now).toISOString(),
    fileId,
  };
}

/** Rows across every table, for the "pushed" count on a first sync. */
export function countRows(tables: Readonly<Record<string, unknown[]>>): number {
  return Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
}

/**
 * Parse the shared file, or null when it is not one.
 *
 * Deliberately strict about the SHAPE and permissive about the contents: a
 * table this build does not know about is kept and passed through the merge,
 * because it belongs to a feature the other phone has and this one has not
 * updated to yet.
 */
export function parseSyncFile(
  contents: string,
): Record<string, Record<string, unknown>[]> | null {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const out: Record<string, Record<string, unknown>[]> = {};
    for (const [table, rows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(rows)) return null;
      out[table] = rows as Record<string, unknown>[];
    }
    return out;
  } catch {
    return null;
  }
}

/** The id out of a Drive create response. */
function idOf(payload: unknown): string | null {
  const id = (payload as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
