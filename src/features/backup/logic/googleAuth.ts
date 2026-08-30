/**
 * Google OAuth for a mobile app, without an OAuth library.
 *
 * ## Why hand-rolled
 *
 * The usual answer is `expo-auth-session`, which is not installed and is a
 * native dependency — adding it means a rebuild before anything works. But the
 * three pieces it actually needs are already here: `expo-linking` to open the
 * browser and catch the redirect, `expo-crypto` for the PKCE digest, and
 * `expo-secure-store` to keep the refresh token. The protocol itself is a few
 * URL builders, so this file is those builders and nothing else.
 *
 * ## PKCE, and why there is no client secret
 *
 * A mobile app cannot keep a secret — anything shipped in the binary is
 * readable by anyone who downloads it. So this uses the Authorization Code flow
 * with PKCE (RFC 7636), which is designed for exactly that: the app generates a
 * random `code_verifier`, sends only its SHA-256 hash when starting the flow,
 * and proves possession by sending the original when exchanging the code.
 * Someone who intercepts the redirect gets a code they cannot use.
 *
 * The Google client is an **iOS OAuth client**, which Google issues with no
 * secret at all — the redirect URI is tied to the bundle id, so only this app
 * can receive the callback.
 *
 * Pure string work: every function here builds or parses, and nothing performs
 * I/O. The device half lives in services/googleDrive.ts.
 */

/*
 * The requested scope is OWNED BY driveSync.ts, not redeclared here.
 *
 * There were briefly two constants — this file asked for `drive.appdata` while
 * the Drive layer built requests against a visible `money-manager` folder,
 * which needs `drive.file`. The consent screen would have granted access to the
 * hidden app folder and every subsequent Drive call would have failed with a
 * permission error that looks nothing like its cause.
 *
 * Re-exported under the old name so existing imports keep working, but there is
 * exactly one definition.
 */
import { DRIVE_SCOPE } from './driveSync';

export { DRIVE_SCOPE };

/** @deprecated Use `DRIVE_SCOPE`. Kept so older imports still resolve. */
export const DRIVE_APPDATA_SCOPE = DRIVE_SCOPE;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * The OAuth client id, read from app config at runtime.
 *
 * NOT a secret — an iOS OAuth client has none, and the id is visible in the
 * redirect URI regardless. Kept in config rather than hardcoded so a fork or a
 * second environment can point at its own Google project without a code change.
 */
export function redirectUriFor(clientId: string): string {
  /*
   * Google's iOS clients use the REVERSED client id as the URL scheme — the
   * documented convention, and the only redirect an iOS client accepts besides
   * a loopback address. `com.googleusercontent.apps.123-abc:/oauth` rather than
   * the app's own `moneymanager://` scheme, which Google would reject.
   *
   * One slash after the colon, not two: this is a path, not a host.
   */
  const reversed = clientId.replace(/^(.*)\.apps\.googleusercontent\.com$/, 'com.googleusercontent.apps.$1');
  return `${reversed}:/oauth2redirect`;
}

/** A PKCE challenge pair. The verifier never leaves the device until exchange. */
export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * base64url — RFC 4648 §5, which is what OAuth requires.
 *
 * Standard base64's `+`, `/` and `=` are not URL-safe, and Google rejects a
 * challenge containing them rather than normalising, so the substitution has to
 * happen here.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  // btoa exists in React Native's JS runtime.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The authorization URL to open in the browser.
 *
 * `access_type=offline` plus `prompt=consent` is what makes Google return a
 * REFRESH token. Without both, a second sign-in returns only an access token
 * that expires in an hour, and the user is asked to sign in again every time
 * they open the app — which reads as the integration being broken.
 *
 * `select_account` rides alongside so the ACCOUNT CHOOSER always appears.
 * Google otherwise reuses whichever account the browser is already signed into,
 * which makes "use a different account" silently return the same one — and
 * someone whose backups sit in their other account has no way through.
 */
export function buildAuthUrl(options: {
  clientId: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: redirectUriFor(options.clientId),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state,
    access_type: 'offline',
    // Space-separated, per the OAuth spec — both prompts apply.
    prompt: 'consent select_account',
  });

  return `${AUTH_ENDPOINT}?${params}`;
}

/**
 * Read the redirect the browser sent back.
 *
 * Returns the code, or the error Google reported. `state` is returned for the
 * caller to compare against what it sent — an unmatched state means the
 * redirect did not come from the flow this app started, and the code must be
 * discarded rather than exchanged.
 */
export function parseAuthRedirect(url: string): {
  code: string | null;
  state: string | null;
  error: string | null;
} {
  try {
    // The custom scheme is not a hierarchical URL, so `new URL` cannot be
    // relied on across runtimes — read the query directly.
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);

    return {
      code: params.get('code'),
      state: params.get('state'),
      error: params.get('error'),
    };
  } catch {
    return { code: null, state: null, error: 'malformed_redirect' };
  }
}

/** The token exchange request — built here, executed by the caller. */
export interface TokenRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** Exchange the authorization code for tokens. */
export function buildTokenExchange(options: {
  clientId: string;
  code: string;
  verifier: string;
}): TokenRequest {
  return {
    url: TOKEN_ENDPOINT,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.clientId,
      code: options.code,
      code_verifier: options.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriFor(options.clientId),
    }).toString(),
  };
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * Access tokens last an hour; the refresh token is what makes the sign-in
 * durable, so this runs before any Drive call rather than waiting for a 401.
 */
export function buildTokenRefresh(options: {
  clientId: string;
  refreshToken: string;
}): TokenRequest {
  return {
    url: TOKEN_ENDPOINT,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.clientId,
      refresh_token: options.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  };
}

/** What a token endpoint returned. */
export interface TokenSet {
  accessToken: string;
  /** Absent on a refresh — Google only issues one at initial consent. */
  refreshToken: string | null;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
}

/**
 * Read a token response.
 *
 * `expires_in` is seconds-from-now, which is useless once stored, so it is
 * converted to an absolute instant. Sixty seconds are shaved off: a token that
 * expires while a request is in flight fails in a way that looks like a
 * permission problem, and refreshing a minute early costs nothing.
 */
export function parseTokenResponse(payload: unknown, now = Date.now()): TokenSet | null {
  if (payload === null || typeof payload !== 'object') return null;

  const body = payload as Record<string, unknown>;
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;

  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: now + Math.max(0, expiresIn - 60) * 1000,
  };
}

/**
 * Whether a token response says the REFRESH TOKEN itself is dead.
 *
 * Google answers a refresh with `invalid_grant` when the token has been
 * revoked, expired through disuse, or belongs to an account whose password
 * changed. That is permanent: no retry will fix it, and only signing in again
 * will.
 *
 * Worth telling apart from every other failure — no network, a 500, a timeout —
 * because the response to those is to try later, whereas the response to this
 * is to forget the connection and ask the user to sign in. Treating the two
 * alike is what leaves an account showing "Connected" while every upload fails.
 */
export function isRefreshTokenDead(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  const error = (payload as Record<string, unknown>).error;
  // `invalid_client` is included because a client id that no longer exists
  // cannot be recovered from either; both need a fresh sign-in to resolve.
  return error === 'invalid_grant' || error === 'invalid_client';
}

/** Whether a stored token still has life in it. */
export function isTokenValid(token: TokenSet | null, now = Date.now()): boolean {
  return token !== null && token.accessToken.length > 0 && token.expiresAt > now;
}
