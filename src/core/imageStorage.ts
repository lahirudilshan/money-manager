import { Directory, File, Paths } from 'expo-file-system';

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

/** Removes a previously persisted photo — used by the "remove photo" affordance. */
export function deletePersistedImage(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}
