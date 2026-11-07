import { Directory, File, Paths } from 'expo-file-system';
import { parseImageRef } from './imageRef';

/**
 * Getting a displayable path out of a stored image reference.
 *
 * A reference may name a local file, a Drive id, or both (see `imageRef.ts`).
 * The screens want one thing: a URI to hand to `<Image>`. This resolves that,
 * preferring whatever needs no network.
 *
 * Downloads are cached under the app's cache directory rather than its
 * documents: a re-downloadable copy is not data the user would miss if iOS
 * reclaimed the space, and putting it in documents would have it backed up by
 * iCloud alongside the originals for no benefit.
 */

const CACHE_DIR_NAME = 'drive-attachments';

/**
 * Where a Drive file lands once fetched.
 *
 * The extension matters: a PDF saved as `.jpg` cannot be previewed, because iOS
 * picks the viewer by extension. The downloader sniffs the bytes and passes it.
 */
export function cachedPathFor(driveId: string, extension: string = 'jpg'): string {
  const dir = new Directory(Paths.cache, CACHE_DIR_NAME);
  return new File(dir, `${driveId}.${extension}`).uri;
}

/** The cached copy of this Drive file, whichever kind it turned out to be. */
function cachedCopy(driveId: string, extra?: string): string | null {
  // `extra` is the real extension when the caller knows it — a Documents file
  // can be a .docx, which the byte sniff in the downloader cannot tell apart.
  const candidates = extra && extra !== 'jpg' && extra !== 'pdf' ? [extra, 'jpg', 'pdf'] : ['jpg', 'pdf'];
  for (const extension of candidates) {
    try {
      const path = cachedPathFor(driveId, extension);
      if (new File(path).exists) return path;
    } catch {
      // A cache miss and an unreadable cache are the same thing: fetch again.
    }
  }
  return null;
}

/** True when this Drive file has already been fetched. */
export function isCached(driveId: string): boolean {
  return cachedCopy(driveId) !== null;
}

/**
 * The URI to render, or null when the photo must be fetched first.
 *
 * Order matters and is not arbitrary:
 *
 *  1. the local original, on the phone that took the photo — always there,
 *     never stale, no network;
 *  2. a cached download, on the other phone;
 *  3. null, meaning "ask Drive" — the caller shows a placeholder meanwhile.
 *
 * Checking the local path's existence rather than trusting it matters after a
 * reinstall: the container path changes, so a stored `file://` can name a file
 * that is no longer there. Without the check the screen would render a broken
 * image instead of falling through to the Drive copy that is still good.
 */
export function resolveImageUri(
  stored: string | null | undefined,
  /** The file's own extension, for attachments that are neither JPG nor PDF. */
  extension?: string,
): string | null {
  const { driveId, localUri } = parseImageRef(stored);

  if (localUri) {
    try {
      if (new File(localUri).exists) return localUri;
    } catch {
      // Fall through to the Drive copy.
    }
  }

  return driveId ? cachedCopy(driveId, extension) : null;
}

/** Make sure the cache directory exists before writing into it. */
export function ensureCacheDir(): void {
  const dir = new Directory(Paths.cache, CACHE_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
}

/**
 * Whether this reference needs fetching before it can be shown.
 *
 * Distinct from "has no photo": a row with a Drive id and no cached copy has a
 * photo that simply is not here yet, and the screen should say so rather than
 * render as empty.
 */
export function needsFetch(stored: string | null | undefined): boolean {
  const { driveId } = parseImageRef(stored);
  if (!driveId) return false;
  return resolveImageUri(stored) === null;
}
