import { Share } from 'react-native';

/**
 * Get a string out of the app and into somewhere the user can paste it.
 *
 * DELIBERATELY NOT `expo-clipboard`. That module calls `requireNativeModule` at
 * the top level of its own file, so on a build that predates it linked, merely
 * REQUIRING it throws "Cannot find native module 'ExpoClipboard'" — and Metro
 * hoists the transpiled import above any surrounding `try`, so the throw escapes
 * the guard and takes down the screen. Wrapping the require is not enough; the
 * only safe move is to not reference the module at all.
 *
 * That is the second time a lazily-guarded native module has crashed this app
 * (see services/network.ts for the `expo-network` version of the same lesson),
 * and this feature already needs one native rebuild — it should not need a
 * second one just to copy a short string.
 *
 * `Share` is part of React Native, works on every build with no rebuild, and
 * reaches strictly more places than the clipboard does: Notes, a message to
 * yourself, AirDrop to a Mac — and "Copy" is the first item in the sheet, which
 * is the exact action the user wanted.
 */

/**
 * Offer `text` for the user to copy or send.
 *
 * Resolves false when the sheet could not be shown, so the caller can tell the
 * user to select the text by hand rather than claiming a copy that never
 * happened. Dismissing the sheet counts as success — the user saw it and chose
 * not to act, which is not an error worth reporting back to them.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await Share.share({ message: text });
    return true;
  } catch {
    return false;
  }
}
