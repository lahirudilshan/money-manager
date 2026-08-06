import { Share } from 'react-native';

/**
 * Get a string out of the app and into somewhere the user can paste it.
 *
 * `expo-clipboard` is the right tool — the user asked to COPY a path, and a
 * share sheet makes them pick "Copy" out of a list of things they did not want.
 * It is a native module, though, so it only exists on a build made after it was
 * added, and that is the whole reason this file is careful:
 *
 * IT MUST NOT BE IMPORTED AT THE TOP LEVEL. The module calls
 * `requireNativeModule` while its own file is being evaluated, so on a binary
 * that predates it, merely REQUIRING it throws "Cannot find native module
 * 'ExpoClipboard'". Metro hoists a transpiled `import` above any surrounding
 * `try`, so the throw escapes the guard and takes down the screen. A lazy
 * `require` inside the function body is evaluated at call time, where a `try`
 * genuinely catches it.
 *
 * That is the third time a lazily-guarded native module has bitten this app
 * (see services/network.ts for the `expo-network` version), hence the belt and
 * braces: when the module is missing we fall back to `Share`, which is part of
 * React Native, needs no rebuild, and whose first item is "Copy" — so an older
 * build still does the job in two taps instead of failing.
 */

/** The slice of expo-clipboard used here, so the lazy require stays typed. */
interface ClipboardModule {
  setStringAsync: (text: string) => Promise<boolean>;
  getStringAsync: () => Promise<string>;
  /** Whether the pasteboard holds text — does NOT read it, so no prompt. */
  hasStringAsync: () => Promise<boolean>;
}

/**
 * Put `text` on the clipboard.
 *
 * Resolves false only when neither the clipboard nor the share sheet worked, so
 * the caller can tell the user to select the text by hand rather than claiming
 * a copy that never happened.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const clipboard = require('expo-clipboard') as ClipboardModule;
    await clipboard.setStringAsync(text);
    return true;
  } catch {
    // Older binary without the native module — fall back rather than fail.
    return shareFallback(text);
  }
}

/**
 * The pre-clipboard behaviour, kept for builds that predate the native module.
 *
 * Dismissing the sheet counts as success: the user saw it and chose not to act,
 * which is not an error worth reporting back to them.
 */
async function shareFallback(text: string): Promise<boolean> {
  try {
    await Share.share({ message: text });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the clipboard, or null when it holds nothing usable.
 *
 * Used by the paste screen to offer what the user has almost certainly just
 * copied. Never throws and never prompts: on iOS 16+ reading the pasteboard can
 * show a "allow paste?" banner, which is why this is called ONCE when the
 * screen opens rather than polled — a repeated prompt would be worse than
 * making the user paste by hand.
 */
export async function readClipboard(): Promise<string | null> {
  try {
    // Same lazy require as `copyToClipboard` — an older binary without the
    // native module simply returns null rather than throwing at import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const clipboard = require('expo-clipboard') as ClipboardModule;

    /*
     * Ask whether there is text BEFORE reading it.
     *
     * On iOS 16+ `getStringAsync` shows a system "allow paste?" dialog, and
     * that prompt is the whole cost of this feature — it appears before the
     * user has seen anything, on a screen they may have opened for another
     * reason. `hasStringAsync` inspects the pasteboard without reading it and
     * raises no prompt, so an empty clipboard costs nothing at all.
     *
     * It cannot tell us whether the text is a bank message, so a prompt still
     * appears when something IS copied. That is the irreducible part: iOS will
     * not let an app look at clipboard contents unasked.
     */
    if (!(await clipboard.hasStringAsync())) return null;

    const text = await clipboard.getStringAsync();
    return typeof text === 'string' && text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}
