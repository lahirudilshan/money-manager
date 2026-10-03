/**
 * What the database stores for an attached photo.
 *
 * ## The problem this solves
 *
 * Until now a row held an absolute `file://` URI into the app's document
 * directory. That is fine on one phone and meaningless anywhere else: the
 * container path changes on reinstall, and on a second phone the file does not
 * exist at all. A synced row would carry a path pointing at nothing, and the
 * screen would render a broken image with no way to tell that from a photo the
 * user never added.
 *
 * ## The shape
 *
 * A reference is stored as a small string rather than a JSON blob, because
 * eight tables hold this column and every one of them already treats it as
 * text:
 *
 *     file:///…/transaction-photos/1727.jpg          local only, not yet up
 *     drive:1a2B3c|file:///…/1727.jpg                uploaded, local copy kept
 *     drive:1a2B3c                                   uploaded, no local copy
 *
 * The local half is kept after upload so the image renders instantly from disk
 * and needs no network on the phone that took it. The Drive half is what makes
 * it portable. Either half alone is a valid, meaningful state.
 *
 * Old rows hold a bare `file://` URI, which parses as "local only" — so
 * nothing needs migrating and an older build reading a new row still finds a
 * usable path in the part it understands.
 */

const DRIVE_PREFIX = 'drive:';
const SEPARATOR = '|';

export interface ImageRef {
  /** Drive file id, once uploaded. */
  driveId: string | null;
  /** Local `file://` path, while a copy is still on this device. */
  localUri: string | null;
}

/** Nothing attached. */
export const EMPTY_REF: ImageRef = { driveId: null, localUri: null };

/**
 * Read a stored value.
 *
 * Total, and never throws: this runs while rendering a list, and a malformed
 * value should show as "no photo" rather than take the screen down.
 */
export function parseImageRef(stored: string | null | undefined): ImageRef {
  if (typeof stored !== 'string' || stored === '') return EMPTY_REF;

  const parts = stored.split(SEPARATOR);
  let driveId: string | null = null;
  let localUri: string | null = null;

  for (const part of parts) {
    if (part.startsWith(DRIVE_PREFIX)) {
      const id = part.slice(DRIVE_PREFIX.length);
      if (id) driveId = id;
    } else if (part.length > 0) {
      // Anything that is not a drive marker is a path — including the bare
      // `file://` URI every row written before this existed.
      localUri = part;
    }
  }

  return { driveId, localUri };
}

/**
 * Write a reference back to its stored form.
 *
 * Returns null for an empty reference so callers can assign it straight to a
 * nullable column, rather than storing an empty string that reads as "a photo
 * whose path we lost".
 */
export function formatImageRef(ref: ImageRef): string | null {
  const parts: string[] = [];
  if (ref.driveId) parts.push(`${DRIVE_PREFIX}${ref.driveId}`);
  if (ref.localUri) parts.push(ref.localUri);
  return parts.length > 0 ? parts.join(SEPARATOR) : null;
}

/** A freshly picked photo, on this device and not yet uploaded. */
export function localRef(uri: string): string | null {
  return formatImageRef({ driveId: null, localUri: uri });
}

/** Record that a local photo now also exists in Drive. */
export function withDriveId(stored: string | null, driveId: string): string | null {
  return formatImageRef({ ...parseImageRef(stored), driveId });
}

/**
 * Drop the local path, keeping the Drive copy.
 *
 * For the device that did NOT take the photo: it has downloaded and cached the
 * file, but the cache is disposable and the reference should not claim a path
 * that may be swept away.
 */
export function withoutLocal(stored: string | null): string | null {
  return formatImageRef({ ...parseImageRef(stored), localUri: null });
}

/** True when there is a photo at all, in either place. */
export function hasImage(stored: string | null | undefined): boolean {
  const ref = parseImageRef(stored);
  return ref.driveId !== null || ref.localUri !== null;
}

/** True when this photo still needs uploading. */
export function needsUpload(stored: string | null | undefined): boolean {
  const ref = parseImageRef(stored);
  return ref.driveId === null && ref.localUri !== null;
}
