import { Share } from 'react-native';

/**
 * Picking PDFs and opening any attachment — the device half of attachments.
 *
 * `expo-document-picker` is a native module. A build made before it was added
 * does not contain it, and a failing native require does not reliably land in a
 * try/catch (see `money-manager-native-modules`), so the module registry is
 * checked first — the same probe app/onboarding/welcome.tsx uses.
 */

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
}

type PickResult = { ok: true; files: PickedFile[] } | { ok: false; error?: string };

function hasNativeModule(name: string): boolean {
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return Boolean(registry?.[name]);
}

/** Choose one or more PDFs from Files. `ok: false` with no error = cancelled. */
export async function pickPdfFiles({ multiple }: { multiple: boolean }): Promise<PickResult> {
  return pickFiles({ multiple, types: ['application/pdf'] });
}

/**
 * Choose any file from Files — PDF, Word, spreadsheet, photo, anything.
 *
 * `types` defaults to everything; the Documents add-on files whatever the
 * user keeps, not only what the app knows how to draw.
 */
export async function pickFiles({
  multiple,
  types = ['*/*'],
}: {
  multiple: boolean;
  types?: string[];
}): Promise<PickResult> {
  if (!hasNativeModule('ExpoDocumentPicker')) {
    return { ok: false, error: 'Choosing a file needs an updated build of the app.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');

  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: types,
      multiple,
      // The picker's own URI is security-scoped and short-lived; the cache copy
      // is a plain file the app can read and then persist.
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return { ok: false };
    return {
      ok: true,
      files: (picked.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? (types.length === 1 && types[0] !== '*/*' ? types[0] : 'application/octet-stream'),
        size: asset.size ?? null,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Files could not be opened.',
    };
  }
}

/**
 * Open a local attachment in the system viewer.
 *
 * Through the share sheet: on iOS it shows a Quick Look preview of a PDF at the
 * top, plus "Open in…", "Save to Files" and "Print" — everything someone does
 * with a report — without adding a PDF-rendering native module.
 */
export async function openAttachment(localUri: string): Promise<void> {
  try {
    await Share.share({ url: localUri });
  } catch {
    // Dismissed, or nothing could handle it. Neither needs a message.
  }
}
