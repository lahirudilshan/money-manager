import Constants from 'expo-constants';
import {
  buildAuthUrl,
  buildTokenExchange,
  parseAuthRedirect,
  parseTokenResponse,
  redirectUriFor,
} from '~/features/backup/logic/googleAuth';
import { driveClientId } from '~/features/backup/logic/googleDrive';
import {
  classifyCloudError,
  CLOUD_SCOPE,
  createKeyRequest,
  createProjectRequest,
  describeCloudProblem,
  EMAIL_SCOPE,
  enableGeminiRequest,
  findProjectRequest,
  keyStringRequest,
  listKeysRequest,
  newProjectId,
  operationRequest,
  readExistingKey,
  readFoundProject,
  readKeyString,
  readOperation,
  type CloudRequest,
  type SetupStep,
} from '~/features/health/logic/userGemini';

/**
 * "Use my Google account" for AI reading — the half that talks to Google.
 * See `logic/userGemini.ts` for why and how.
 *
 * Only the Gemini KEY is kept, in the keychain. The Cloud sign-in that made
 * it can create projects in the user's account, so it is used for the set-up
 * and then dropped — never stored.
 */

const KEY_STORE = 'gemini_user_key';
const ACCOUNT_STORE = 'gemini_user_account';
const PROJECT_STORE = 'gemini_user_project';

type SecureStore = typeof import('expo-secure-store');
type WebBrowser = typeof import('expo-web-browser');
type Crypto = typeof import('expo-crypto');

function registryHas(name: string): boolean {
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return Boolean(registry?.[name]);
}

/* eslint-disable @typescript-eslint/no-require-imports */
function secureStore(): SecureStore | null {
  try {
    return require('expo-secure-store') as SecureStore;
  } catch {
    return null;
  }
}
function webBrowser(): WebBrowser | null {
  // Probe first — see googleDrive.ts `loadWebBrowser` for why a try/catch alone fails.
  if (!registryHas('ExpoWebBrowser')) return null;
  try {
    return require('expo-web-browser') as WebBrowser;
  } catch {
    return null;
  }
}
function crypto(): Crypto | null {
  try {
    return require('expo-crypto') as Crypto;
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function appBundleId(): string {
  return Constants.expoConfig?.ios?.bundleIdentifier ?? 'com.lahirudilshan.dayly';
}

/** In memory once read; `undefined` = not read yet, `null` = none. */
let cached: { key: string; account: string | null } | null | undefined;

/** The user's own key, if set up. Reads the keychain once per session. */
export async function userGeminiKey(): Promise<{ key: string; account: string | null } | null> {
  if (cached !== undefined) return cached;
  const store = secureStore();
  if (!store) return (cached = null);
  try {
    const key = await store.getItemAsync(KEY_STORE);
    cached = key ? { key, account: await store.getItemAsync(ACCOUNT_STORE) } : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Synchronous view of the cache — call `userGeminiKey()` once first. */
export function userGeminiKeyCached(): { key: string; account: string | null } | null {
  return cached ?? null;
}

/** Stop using the user's key. The project stays in their account, harmless. */
export async function forgetUserGemini(): Promise<void> {
  cached = null;
  const store = secureStore();
  if (!store) return;
  for (const k of [KEY_STORE, ACCOUNT_STORE, PROJECT_STORE]) {
    await store.deleteItemAsync(k).catch(() => undefined);
  }
}

/** Whether this build can run the set-up at all. */
export function canSetUpUserGemini(): boolean {
  return driveClientId() !== null && webBrowser() !== null && crypto() !== null && secureStore() !== null;
}

export type SetupResult =
  | { ok: true; account: string | null }
  | { ok: false; cancelled?: boolean; error: string; url?: string };

class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`[${status}] ${body.slice(0, 300)}`);
  }
}

async function call(token: string, request: CloudRequest): Promise<Record<string, unknown>> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: request.body,
  });
  const text = await response.text();
  if (!response.ok) throw new CloudError(response.status, text);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Run a long operation to its end: Google answers "started", then "done". */
async function finish(token: string, started: Record<string, unknown>) {
  let state = readOperation(started);
  const name = typeof started.name === 'string' ? started.name : null;
  for (let attempt = 0; !state.done && name && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 1000 : 2000));
    state = readOperation(await call(token, operationRequest(name)));
  }
  if (state.error) throw new CloudError(400, state.error);
  if (!state.done) throw new CloudError(0, 'Google took too long to finish the set-up.');
  return state.response;
}

async function signInForCloud(): Promise<
  { ok: true; token: string } | { ok: false; cancelled?: boolean; error: string }
> {
  const clientId = driveClientId();
  const browser = webBrowser();
  const c = crypto();
  if (!clientId || !browser || !c) return { ok: false, error: 'Google sign-in is unavailable.' };

  const hex = async (n: number) =>
    Array.from(await c.getRandomBytesAsync(n))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const verifier = await hex(32);
  const state = await hex(16);
  const challenge = (
    await c.digestStringAsync(c.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: c.CryptoEncoding.BASE64,
    })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await browser.openAuthSessionAsync(
    buildAuthUrl({ clientId, challenge, state, scope: `${CLOUD_SCOPE} ${EMAIL_SCOPE}` }),
    redirectUriFor(clientId),
    { preferEphemeralSession: false },
  );
  if (result.type !== 'success') return { ok: false, cancelled: true, error: 'Sign-in was cancelled.' };
  const parsed = parseAuthRedirect(result.url);
  if (parsed.state !== state) return { ok: false, error: 'Sign-in could not be verified.' };
  if (parsed.error) {
    return {
      ok: false,
      error:
        parsed.error === 'access_denied'
          ? 'Dayly needs that permission to set up AI in your account.'
          : `Google said: ${parsed.error}`,
    };
  }
  if (!parsed.code) return { ok: false, cancelled: true, error: 'Sign-in was cancelled.' };

  const exchange = buildTokenExchange({ clientId, code: parsed.code, verifier });
  const response = await fetch(exchange.url, {
    method: 'POST',
    headers: exchange.headers,
    body: exchange.body,
  });
  const tokens = parseTokenResponse(await response.json());
  if (!tokens) return { ok: false, error: 'Google did not finish the sign-in. Try again.' };
  return { ok: true, token: tokens.accessToken };
}

async function accountEmail(token: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await r.json()) as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}

/** A tiny call that proves the key answers — before telling the user it worked. */
async function keyWorks(key: string): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    { headers: { 'x-goog-api-key': key, 'X-Ios-Bundle-Identifier': appBundleId() } },
  );
  return { ok: response.ok, status: response.status, body: await response.text() };
}

/**
 * The whole set-up. Safe to run again: it reuses the "Dayly AI" project and
 * the key it made before rather than piling up new ones.
 */
export async function setUpUserGemini(onStep: (step: SetupStep) => void): Promise<SetupResult> {
  const store = secureStore();
  if (!store || !canSetUpUserGemini()) {
    return { ok: false, error: 'This version of the app cannot set this up. Update Dayly.' };
  }

  onStep('signing-in');
  const signedIn = await signInForCloud();
  if (!signedIn.ok) return signedIn;
  const { token } = signedIn;

  try {
    onStep('project');
    const account = await accountEmail(token);
    let projectId = readFoundProject(await call(token, findProjectRequest()).catch(() => ({})));
    if (!projectId) {
      projectId = newProjectId(Math.random().toString(36).slice(2) + Date.now().toString(36));
      await finish(token, await call(token, createProjectRequest(projectId)));
    }

    onStep('gemini');
    await finish(token, await call(token, enableGeminiRequest(projectId)));

    onStep('key');
    const bundleId = appBundleId();
    const existing = readExistingKey(await call(token, listKeysRequest(projectId)), bundleId);
    let key: string | null;
    if (existing) {
      key = readKeyString(await call(token, keyStringRequest(existing)));
    } else {
      const made = await finish(token, await call(token, createKeyRequest(projectId, bundleId)));
      key = readKeyString(made);
      if (!key && typeof made?.name === 'string') {
        key = readKeyString(await call(token, keyStringRequest(made.name)));
      }
    }
    if (!key) throw new CloudError(0, 'Google did not return the key.');

    onStep('checking');
    // A brand-new key can take a few seconds to be accepted everywhere.
    let check = await keyWorks(key);
    for (let i = 0; !check.ok && i < 5 && (check.status === 400 || check.status === 403); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      check = await keyWorks(key);
    }
    if (!check.ok) throw new CloudError(check.status, check.body);

    await store.setItemAsync(KEY_STORE, key);
    await store.setItemAsync(PROJECT_STORE, projectId);
    if (account) await store.setItemAsync(ACCOUNT_STORE, account);
    else await store.deleteItemAsync(ACCOUNT_STORE).catch(() => undefined);
    cached = { key, account };
    onStep('done');
    return { ok: true, account };
  } catch (error) {
    const status = error instanceof CloudError ? error.status : 0;
    const body = error instanceof CloudError ? error.body : String(error);
    if (__DEV__) console.log(`[user gemini] set-up failed (${status}): ${body.slice(0, 500)}`);
    const problem = describeCloudProblem(classifyCloudError(status, body));
    return { ok: false, error: problem.message, url: problem.url };
  }
}
