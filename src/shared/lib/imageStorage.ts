import { Directory, File, Paths } from 'expo-file-system';
import { parseImageRef } from './imageRef';

const PHOTOS_DIR_NAME = 'transaction-photos';

/**
 * Copies a picked image (camera or library, both return a cache/temp URI
 * from expo-image-picker) into the app's document directory. Picker URIs
 * are not guaranteed to survive an app restart or cache clear, so anything
 * meant to be looked at again later must be copied out immediately.
 */
export async function persistPickedImage(sourceUri: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTOS_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const destination = new File(dir, filename);
  await new File(sourceUri).copy(destination);
  return destination.uri;
}

/**
 * Removes a previously persisted photo — used by the "remove photo" affordance.
 *
 * Takes the STORED value rather than a path, because that value may be a
 * reference carrying a Drive id as well ("drive:abc|file:///…"). Passing the
 * whole string to `new File` would name a file that does not exist, so the
 * delete would silently do nothing and leave the photo on disk forever.
 *
 * Only the local copy is removed. The Drive copy is deleted by the sync pass,
 * which is the only place that holds a token.
 */
export function deletePersistedImage(stored: string): void {
  const { localUri } = parseImageRef(stored);
  if (!localUri) return;

  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // A file that cannot be deleted is a leaked photo, not a failed removal:
    // the row has already let go of it, and throwing here would fail the edit
    // the user was making.
  }
}
