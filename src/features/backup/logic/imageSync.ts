/**
 * Getting attached photos off the device and into Drive.
 *
 * ## Why photos need their own pass
 *
 * Row sync ships a JSON file: every table, every column, one document. A
 * receipt is binary and often larger than the whole rest of the database, so
 * putting it in that file would mean base64 (a third bigger again) and a
 * single upload that fails as one unit. Photos therefore go to Drive as
 * ordinary files, and the row stores the id they came back with — see
 * `imageRef.ts` for the stored form.
 *
 * ## Local first, upload after
 *
 * The photo is copied into the app's own storage the moment it is picked, and
 * the form saves immediately. Uploading happens afterwards, in the background.
 * That ordering is what makes the feature usable on a phone with no signal:
 * the attachment is never blocked on a network call, and an upload that fails
 * is retried on the next pass rather than losing the photo.
 *
 * This module holds the DECISIONS — what needs uploading, what a result means,
 * how a failure is handled. The network calls and the database writes live
 * with their own layers, so every rule here is testable without either.
 */

import { needsUpload, parseImageRef, withDriveId } from '~/shared/lib/imageRef';

/** Every table carrying an `image_uri`, with the column holding its id. */
export const IMAGE_TABLES = [
  'subcategory_states',
  'transactions',
  'vehicles',
  'fuel_entries',
  'health_people',
  'health_documents',
  'buddy_loans',
  'buddy_repayments',
] as const;

export type ImageTable = (typeof IMAGE_TABLES)[number];

/** One row holding a photo that is not in Drive yet. */
export interface PendingImage {
  table: ImageTable;
  rowId: string;
  /** The value currently stored, as written by `imageRef`. */
  stored: string;
  /** The local file to send. */
  localUri: string;
}

/** A row as the queue reads it — only the two columns that matter here. */
export interface ImageRow {
  id: string;
  image_uri: string | null;
}

/**
 * Which rows still need their photo uploaded.
 *
 * Deliberately includes rows whose value is a bare `file://` path: those
 * predate this feature, and they are exactly the backlog the first pass should
 * clear.
 */
export function pendingUploads(
  rowsByTable: Readonly<Partial<Record<ImageTable, readonly ImageRow[]>>>,
): PendingImage[] {
  const pending: PendingImage[] = [];

  for (const table of IMAGE_TABLES) {
    for (const row of rowsByTable[table] ?? []) {
      if (!needsUpload(row.image_uri)) continue;
      const { localUri } = parseImageRef(row.image_uri);
      // `needsUpload` already guarantees this, but the queue must never emit
      // an entry with nothing to send.
      if (!localUri) continue;
      pending.push({ table, rowId: row.id, stored: row.image_uri as string, localUri });
    }
  }

  return pending;
}

/** What one upload attempt produced. */
export type UploadOutcome =
  | { ok: true; table: ImageTable; rowId: string; nextStored: string }
  | { ok: false; table: ImageTable; rowId: string; error: string; retryable: boolean };

/**
 * Fold an upload result into the value the row should now hold.
 *
 * The local path is KEPT alongside the new id: this device already has the
 * bytes, and dropping the path would make it re-download its own photo.
 */
export function applyUpload(pending: PendingImage, driveId: string): UploadOutcome {
  const nextStored = withDriveId(pending.stored, driveId);
  if (!nextStored) {
    // Unreachable while `pending` carries a local path, but a silently dropped
    // reference would lose the photo, so it is stated rather than assumed.
    return {
      ok: false,
      table: pending.table,
      rowId: pending.rowId,
      error: 'Upload succeeded but the reference could not be written.',
      retryable: false,
    };
  }
  return { ok: true, table: pending.table, rowId: pending.rowId, nextStored };
}

/**
 * Whether a failed upload is worth trying again.
 *
 * A missing local file never is — the photo is gone, and retrying forever
 * would mean every later pass spends its budget on a row that cannot succeed.
 * Everything else (offline, rate limited, a 5xx) is transient by default:
 * assuming otherwise abandons a photo the user can still see on their screen.
 */
export function isRetryable(error: { status?: number; code?: string } | null): boolean {
  if (!error) return true;
  if (error.code === 'ENOENT' || error.code === 'FILE_MISSING') return false;

  const status = error.status;
  if (typeof status !== 'number') return true;
  // 401 is retryable: the token refreshes and the next pass succeeds.
  if (status === 401) return true;
  // The rest of the 4xx range is the request itself being wrong, which the
  // same request will keep being.
  if (status >= 400 && status < 500) return false;
  return true;
}

/**
 * How many uploads one background pass attempts.
 *
 * A cap rather than "everything pending", because the first pass on a board
 * with a year of receipts would otherwise be a single unbounded burst of
 * uploads on whatever connection the phone happens to have. The remainder is
 * picked up by the next pass; nothing is lost by taking several.
 */
export const UPLOAD_BATCH = 10;

/** The slice of the queue this pass should attempt. */
export function nextBatch(
  pending: readonly PendingImage[],
  limit = UPLOAD_BATCH,
): PendingImage[] {
  return pending.slice(0, Math.max(0, limit));
}

/** What a finished pass did, for the caller to log or show. */
export interface ImageSyncReport {
  uploaded: number;
  failed: number;
  /** Still waiting after this pass — the caller decides whether to run again. */
  remaining: number;
}

/** Summarise a pass from its outcomes. */
export function describeImageSync(
  outcomes: readonly UploadOutcome[],
  totalPending: number,
): ImageSyncReport {
  const uploaded = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - uploaded;
  return { uploaded, failed, remaining: Math.max(0, totalPending - uploaded) };
}

/**
 * A filename that says what the photo belongs to.
 *
 * Drive shows these in a folder the user can open, and a hundred files called
 * `1727384.jpg` would be unreadable. Table and row id make each one traceable
 * back to the record it came from.
 */
export function attachmentFilename(pending: PendingImage): string {
  const extension = pending.localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const safe = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'jpg';
  return `${pending.table}-${pending.rowId}.${safe}`;
}
