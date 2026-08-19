/**
 * Google sign-in and Drive upload — the device half.
 *
 * The protocol lives in core/googleAuth.ts and core/driveSync.ts, both pure and
 * tested. This is the part that cannot be: opening a browser, catching the
 * redirect, keeping a refresh token, and performing HTTP.
 *
 * ## Native modules load LAZILY
 *
 * Matching services/appPin.ts and services/deviceId.ts. A top-level import of a
 * module that is not linked into the current binary throws at STARTUP, which
 * breaks every screen in the app rather than only this feature. Requiring them
 * inside a try/catch means a build without them degrades to "Drive backup
 * unavailable" while everything else keeps working.
 */

import {
  buildAuthUrl,
  buildTokenExchange,
  buildTokenRefresh,
  isTokenValid,
  parseAuthRedirect,
  parseTokenResponse,
  redirectUriFor,
  type TokenSet,
} from '~/features/backup/logic/googleAuth';
import {
  createFolderRequest,
  findFolderRequest,
  deleteBackupRequest,
  downloadBackupRequest,
  listBackupsRequest,
  parseFileList,
  parseFolderId,
  uploadBackupRequest,
  type DriveFile,
  type DriveRequest,
} from '~/features/backup/logic/driveSync';

type WebBrowser = typeof import('expo-web-browser');
type SecureStore = typeof import('expo-secure-store');
type Crypto = typeof import('expo-crypto');

/**
 * Cached so the probe below runs once, not on every render.
 *
 * `undefined` means "not yet attempted"; `null` means "attempted and
 * unavailable". Collapsing the two would re-run a failing require on every
 * call, and Metro logs each failure.
 */
let webBrowserModule: WebBrowser | null | undefined;

function loadWebBrowser(): WebBrowser | null {
  if (webBrowserModule !== undefined) return webBrowserModule;

  /*
   * Probe for the NATIVE module before requiring the JS wrapper.
   *
   * `expo-web-browser`'s entry point calls `requireNativeModule('ExpoWebBrowser')`
   * at module scope, which throws when the binary predates the dependency —
   * and that throw does NOT reliably land in a try/catch around `require`,
   * because Metro evaluates and caches the failing module outside this call
   * stack. Observed directly: an uncaught "Cannot find native module
   * 'ExpoWebBrowser'" redbox on a simulator build, from inside a try/catch
   * written to prevent exactly that.
   *
   * `globalThis.expo.modules` is the registry the native side populates, so
   * checking it asks the question that actually matters — is the module in
   * this binary — without evaluating anything that can throw.
   */
  try {
    const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
    if (!registry || !registry.ExpoWebBrowser) {
      webBrowserModule = null;
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webBrowserModule = require('expo-web-browser') as WebBrowser;
  } catch {
    webBrowserModule = null;
  }

  return webBrowserModule;
}

function loadSecureStore(): SecureStore | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-secure-store') as SecureStore;
  } catch {
    return null;
  }
}

function loadCrypto(): Crypto | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-crypto') as Crypto;
  } catch {
    return null;
  }
}

/**
 * Where the refresh token lives.
 *
 * The KEYSTORE, not the database. A refresh token grants long-lived access to
 * the user's Drive folder, so it belongs in hardware-backed storage rather than
 * a SQLite file that is included in backups — writing it to the database would
 * put a live credential inside every backup file the user shares.
 */
const REFRESH_TOKEN_KEY = 'google_drive_refresh_token';
const ACCOUNT_LABEL_KEY = 'google_drive_account';

/** The OAuth client id, from app config. Not a secret — see core/googleAuth.ts. */
export function driveClientId(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default;
    const id = Constants?.expoConfig?.extra?.googleClientId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Whether Drive backup can run on this build at all. */
export function isDriveAvailable(): boolean {
  return driveClientId() !== null && loadWebBrowser() !== null && loadSecureStore() !== null;
}

/**
 * WHY Drive is unavailable, so the UI can say something true.
 *
 * The two reasons need different actions from the reader — one is a config
 * change, the other a rebuild — and a single "not set up" message sent someone
 * to check a client id that was already correct.
 */
export type DriveBlocker = 'none' | 'no-client-id' | 'needs-rebuild';

export function driveBlocker(): DriveBlocker {
  if (driveClientId() === null) return 'no-client-id';
  // Configured, but the binary predates the dependency — see `loadWebBrowser`.
  if (loadWebBrowser() === null || loadSecureStore() === null) return 'needs-rebuild';
  return 'none';
}

/** Cached in memory for the session; the refresh token is what persists. */
let cachedToken: TokenSet | null = null;

/** Whether the user has connected an account. */
export async function isSignedIn(): Promise<boolean> {
  const store = loadSecureStore();
  if (!store) return false;

  try {
    return (await store.getItemAsync(REFRESH_TOKEN_KEY)) !== null;
  } catch {
    return false;
  }
}

/** Forget the connection. Does not revoke server-side — the user does that in
 *  their Google account settings, and saying so is the honest framing. */
export async function signOut(): Promise<void> {
  cachedToken = null;
  const store = loadSecureStore();
  if (!store) return;

  try {
    await store.deleteItemAsync(REFRESH_TOKEN_KEY);
    await store.deleteItemAsync(ACCOUNT_LABEL_KEY);
  } catch {
    // Already gone.
  }
}

/** Random URL-safe string, for the PKCE verifier and the state parameter. */
async function randomString(bytes = 32): Promise<string> {
  const crypto = loadCrypto();
  if (!crypto) throw new Error('Crypto unavailable');

  const random = await crypto.getRandomBytesAsync(bytes);
  return Array.from(random)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Run the sign-in flow.
 *
 * Uses `openAuthSessionAsync`, which on iOS is `ASWebAuthenticationSession`: a
 * Safari view presented as a SHEET over this app, with a native Cancel button,
 * that dismisses itself when the redirect fires. Three properties matter, and
 * no other option has all three:
 *
 *   - it SHARES SAFARI'S COOKIES, so a user already signed into Google taps
 *     "Continue as …" once instead of typing a password;
 *   - the app stays on screen behind it, rather than iOS switching to Safari
 *     and back (which is what `Linking.openURL` did here before);
 *   - the browser is out-of-process, so this app cannot see the password —
 *     which is exactly why Google BLOCKS embedded WebViews for OAuth
 *     (`disallowed_useragent`). An in-app WebView is not an option, and would
 *     also have its own cookie jar, losing the existing-session convenience.
 *
 * It also returns the redirect URL directly. The previous implementation raced
 * a `Linking` listener against the browser opening, which resolved on whatever
 * deep link arrived NEXT — so backgrounding the app mid-sign-in and tapping an
 * SMS link could resolve the flow with an unrelated URL.
 *
 * Returns `ok: false` with a cancel message when the user backs out, which is
 * not an error and must not be reported as one.
 */
export async function signIn(): Promise<{ ok: boolean; error?: string }> {
  const clientId = driveClientId();
  const browser = loadWebBrowser();
  const crypto = loadCrypto();
  const store = loadSecureStore();

  if (!clientId) return { ok: false, error: 'Google backup is not configured in this build.' };
  if (!browser || !crypto || !store) return { ok: false, error: 'Google sign-in is unavailable.' };

  try {
    const verifier = await randomString();
    const state = await randomString(16);

    const digest = await crypto.digestStringAsync(
      crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: crypto.CryptoEncoding.BASE64 },
    );
    // Base64 → base64url. Google rejects a challenge containing +, / or =.
    const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const result = await browser.openAuthSessionAsync(
      buildAuthUrl({ clientId, challenge, state }),
      redirectUriFor(clientId),
      // Ask iOS NOT to use an ephemeral session: the whole point of the sheet
      // over an isolated WebView is that it reuses the user's existing Google
      // session, and an ephemeral one would throw those cookies away and force
      // a password every time.
      { preferEphemeralSession: false },
    );

    /*
     * Only a `success` carries a redirect URL. `cancel` (Cancel tapped) and
     * `dismiss` are the user backing out deliberately — reporting either as a
     * failure would put an error dialog in front of someone who just changed
     * their mind.
     */
    if (result.type !== 'success') return { ok: false, error: 'Sign-in was cancelled.' };

    const parsed = parseAuthRedirect(result.url);

    /*
     * The state check. An unmatched value means this redirect did not come from
     * the flow this app started, so the code must be discarded rather than
     * exchanged — that is what the parameter exists for.
     */
    if (parsed.state !== state) return { ok: false, error: 'Sign-in could not be verified.' };
    if (parsed.error) return { ok: false, error: `Google said: ${parsed.error}` };
    if (!parsed.code) return { ok: false, error: 'Sign-in was cancelled.' };

    const exchange = buildTokenExchange({ clientId, code: parsed.code, verifier });
    const response = await fetch(exchange.url, {
      method: 'POST',
      headers: exchange.headers,
      body: exchange.body,
    });

    const tokens = parseTokenResponse(await response.json());
    if (!tokens?.refreshToken) {
      return { ok: false, error: 'Google did not return a lasting sign-in. Try again.' };
    }

    await store.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
    cachedToken = tokens;

    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * A usable access token, refreshing when the cached one has expired.
 *
 * Refreshes proactively rather than waiting for a 401: an expired token fails
 * in a way that is indistinguishable from a revoked one, and retrying after the
 * failure doubles every request's latency.
 */
async function accessToken(): Promise<string | null> {
  if (isTokenValid(cachedToken)) return cachedToken!.accessToken;

  const clientId = driveClientId();
  const store = loadSecureStore();
  if (!clientId || !store) return null;

  try {
    const refreshToken = await store.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const request = buildTokenRefresh({ clientId, refreshToken });
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });

    const tokens = parseTokenResponse(await response.json());
    if (!tokens) return null;

    // A refresh response carries no new refresh token; keep the stored one.
    cachedToken = { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
    return cachedToken.accessToken;
  } catch {
    return null;
  }
}

/** Execute a prepared request and parse the JSON, or null on any failure. */
async function send(request: DriveRequest): Promise<unknown | null> {
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    if (!response.ok) return null;
    if (response.status === 204) return {};

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The backup folder's id, creating it the first time.
 *
 * Find-then-create rather than create-always: Drive happily makes a second
 * folder with the same name, and a user whose backups were split across three
 * identically-named "money-manager" folders would have no way to tell which
 * held the newest one.
 */
async function folderId(token: string): Promise<string | null> {
  const found = parseFolderId(await send(findFolderRequest(token)));
  if (found) return found;

  return parseFolderId(await send(createFolderRequest(token)));
}

/** What an upload produced, for the UI to report. */
export interface UploadResult {
  ok: boolean;
  /** ISO timestamp of the upload, for the "last backed up" line. */
  uploadedAt?: string;
  error?: string;
}

/**
 * Upload a snapshot to Drive.
 *
 * Every failure mode returns a message rather than throwing, because the caller
 * shows it to the user — and "backup failed" with no reason is exactly the kind
 * of thing that makes someone stop trusting a backup.
 */
export async function uploadBackup(filename: string, contents: string): Promise<UploadResult> {
  const token = await accessToken();
  if (!token) return { ok: false, error: 'Sign in to Google again to back up.' };

  const folder = await folderId(token);
  if (!folder) return { ok: false, error: 'Could not open the money-manager folder in Drive.' };

  const result = await send(uploadBackupRequest(token, filename, contents, folder));
  if (!result) return { ok: false, error: 'The upload did not complete. Check your connection.' };

  return { ok: true, uploadedAt: new Date().toISOString() };
}

/** The backups currently in Drive, newest first. Empty on any failure. */
export async function listDriveBackups(): Promise<DriveFile[]> {
  const token = await accessToken();
  if (!token) return [];

  const folder = await folderId(token);
  if (!folder) return [];

  return parseFileList(await send(listBackupsRequest(token, folder)));
}

/** What a download produced: the file's raw text, or why it failed. */
export interface DownloadResult {
  ok: boolean;
  /** The snapshot JSON exactly as stored, for the caller to parse. */
  contents?: string;
  error?: string;
}

/**
 * Download one backup's contents from Drive.
 *
 * Deliberately returns TEXT rather than going through `send`. That helper calls
 * `response.json()`, but this request uses `alt=media` and the caller needs the
 * bytes as written — parsing here and re-serialising would risk a snapshot that
 * no longer matches its own integrity check. Handing back the raw string lets
 * `parseSnapshot` and `validateSnapshot` see exactly what was uploaded, which is
 * the only way the restore gates mean anything.
 */
export async function downloadDriveBackup(fileId: string): Promise<DownloadResult> {
  const token = await accessToken();
  if (!token) return { ok: false, error: 'Sign in to Google again to restore.' };

  const request = downloadBackupRequest(token, fileId);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
    });

    if (!response.ok) {
      return { ok: false, error: 'Could not download it from Drive. Check your connection.' };
    }

    return { ok: true, contents: await response.text() };
  } catch {
    return { ok: false, error: 'Could not download it from Drive. Check your connection.' };
  }
}

/**
 * Delete one backup from Drive.
 *
 * Reports a reason rather than throwing, exactly like `uploadBackup`: the
 * caller shows it, and a delete that silently fails leaves the user staring at
 * a row they just removed.
 *
 * The `drive.file` scope only reaches files this app created, so this can never
 * touch anything else in the user's Drive — which is the whole reason that
 * scope was chosen.
 */
export async function deleteDriveBackup(fileId: string): Promise<{ ok: boolean; error?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: 'Sign in to Google again to manage backups.' };

  const result = await send(deleteBackupRequest(token, fileId));

  /*
   * `send` already distinguishes the two cases this needs.
   *
   * A successful DELETE returns 204 with an empty body, which would parse as
   * nothing — so `send` maps 204 to `{}` and reserves `null` for a real
   * failure. Without that, every successful delete would report as an error.
   */
  return result === null
    ? { ok: false, error: 'Could not delete it from Drive. Check your connection.' }
    : { ok: true };
}
