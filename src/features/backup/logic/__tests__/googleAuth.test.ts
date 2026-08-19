import { describe, expect, it } from 'vitest';
import appJson from '../../../../../app.json';
import {
  base64UrlEncode,
  buildAuthUrl,
  buildTokenExchange,
  buildTokenRefresh,
  DRIVE_SCOPE,
  isTokenValid,
  parseAuthRedirect,
  parseTokenResponse,
  redirectUriFor,
} from '../googleAuth';

/**
 * OAuth done by hand, because `expo-auth-session` is not installed and adding
 * it means a native rebuild. The protocol is a handful of URL builders, so the
 * risk is not complexity — it is getting one parameter subtly wrong in a way
 * that only shows up as a hang on a real device. Hence these.
 */

const CLIENT_ID = '123456-abcdef.apps.googleusercontent.com';

describe('redirect URI', () => {
  it('uses the REVERSED client id, which is what Google accepts', () => {
    /*
     * Google's iOS clients redirect to the reversed client id and reject
     * anything else — including the app's own `moneymanager://` scheme. Getting
     * this wrong means the browser never returns and sign-in appears to hang.
     */
    expect(redirectUriFor(CLIENT_ID)).toBe('com.googleusercontent.apps.123456-abcdef:/oauth2redirect');
  });

  it('uses ONE slash after the colon — it is a path, not a host', () => {
    expect(redirectUriFor(CLIENT_ID)).not.toContain('://');
  });
});

describe('the requested scope', () => {
  /*
   * These drifted apart once and it would have been invisible until a real
   * sign-in: `googleAuth` asked for `drive.appdata` (the hidden folder) while
   * `driveSync` built every request against a visible "money-manager" folder,
   * which needs `drive.file`. Consent would have succeeded and then every Drive
   * call would have failed with a permission error that looks nothing like a
   * scope mismatch.
   */
  it('is the same constant the Drive requests are built against', () => {
    const url = buildAuthUrl({ clientId: CLIENT_ID, challenge: 'C', state: 'S' });
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));

    expect(params.get('scope')).toBe(DRIVE_SCOPE);
  });

  it('asks for drive.file, which allows a VISIBLE folder', () => {
    // `drive.appdata` hides the backups completely — a file the user cannot
    // see is one they cannot verify or restore by hand.
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });
});

describe('the configured client id', () => {
  it('derives a redirect URI matching the registered URL scheme', () => {
    /*
     * If `CFBundleURLTypes` and the derived redirect disagree, the browser has
     * nowhere to hand the authorization code back to and sign-in hangs on the
     * consent screen with no error anywhere. Asserted against app.json so a
     * future client-id change cannot silently break the flow.
     */
    const clientId = appJson.expo.extra.googleClientId;
    const registered = appJson.expo.ios.infoPlist.CFBundleURLTypes[0].CFBundleURLSchemes[0];

    expect(clientId.length).toBeGreaterThan(0);
    expect(redirectUriFor(clientId).startsWith(`${registered}:`)).toBe(true);
  });
});

describe('authorization URL', () => {
  const url = buildAuthUrl({ clientId: CLIENT_ID, challenge: 'CHALLENGE', state: 'STATE' });
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));

  it('asks for a code with PKCE', () => {
    // A mobile app cannot keep a secret, so PKCE is what makes an intercepted
    // code useless to whoever grabbed it.
    expect(params.get('response_type')).toBe('code');
    expect(params.get('code_challenge')).toBe('CHALLENGE');
    expect(params.get('code_challenge_method')).toBe('S256');
  });

  it('requests offline access AND consent, or there is no refresh token', () => {
    /*
     * Both are required. Without them Google returns only a one-hour access
     * token, and the user is asked to sign in again every time they open the
     * app — which reads as the integration being broken.
     */
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
  });

  it('carries the state, for verifying the redirect came from this flow', () => {
    expect(params.get('state')).toBe('STATE');
  });

  it('asks only for the Drive scope', () => {
    expect(params.get('scope')).toBe(DRIVE_SCOPE);
  });
});

describe('parseAuthRedirect', () => {
  it('reads the code and state out of a custom-scheme redirect', () => {
    // Not a hierarchical URL, so `new URL` cannot be relied on across runtimes.
    const result = parseAuthRedirect(
      'com.googleusercontent.apps.123456-abcdef:/oauth2redirect?code=AUTH_CODE&state=STATE',
    );

    expect(result.code).toBe('AUTH_CODE');
    expect(result.state).toBe('STATE');
    expect(result.error).toBeNull();
  });

  it('surfaces a refusal rather than reporting it as a missing code', () => {
    const result = parseAuthRedirect(
      'com.googleusercontent.apps.123456-abcdef:/oauth2redirect?error=access_denied',
    );

    expect(result.error).toBe('access_denied');
    expect(result.code).toBeNull();
  });

  it('survives a redirect with no query at all', () => {
    const result = parseAuthRedirect('com.googleusercontent.apps.123456-abcdef:/oauth2redirect');
    expect(result.code).toBeNull();
    expect(result.error).toBeNull();
  });
});

describe('token exchange', () => {
  it('sends the verifier, which is what proves the code is ours', () => {
    const request = buildTokenExchange({ clientId: CLIENT_ID, code: 'CODE', verifier: 'VERIFIER' });
    const body = new URLSearchParams(request.body);

    expect(body.get('code_verifier')).toBe('VERIFIER');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('sends no client secret — an iOS client has none', () => {
    const request = buildTokenExchange({ clientId: CLIENT_ID, code: 'CODE', verifier: 'V' });
    expect(request.body).not.toContain('client_secret');
  });

  it('refreshes with the stored refresh token', () => {
    const body = new URLSearchParams(
      buildTokenRefresh({ clientId: CLIENT_ID, refreshToken: 'REFRESH' }).body,
    );

    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('REFRESH');
  });
});

describe('parseTokenResponse', () => {
  const NOW = 1_000_000_000_000;

  it('converts expires_in into an absolute instant', () => {
    // Seconds-from-now is useless once stored.
    const token = parseTokenResponse(
      { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 },
      NOW,
    );

    expect(token?.accessToken).toBe('AT');
    expect(token?.refreshToken).toBe('RT');
    // 3600 minus the 60s safety margin.
    expect(token?.expiresAt).toBe(NOW + 3540 * 1000);
  });

  it('expires a minute early, so a token cannot die mid-request', () => {
    const token = parseTokenResponse({ access_token: 'AT', expires_in: 3600 }, NOW);
    expect(token!.expiresAt).toBeLessThan(NOW + 3600 * 1000);
  });

  it('tolerates a refresh response, which carries no new refresh token', () => {
    const token = parseTokenResponse({ access_token: 'AT', expires_in: 3600 }, NOW);
    expect(token?.refreshToken).toBeNull();
  });

  it('returns null for an error payload rather than a broken token', () => {
    expect(parseTokenResponse({ error: 'invalid_grant' }, NOW)).toBeNull();
    expect(parseTokenResponse(null, NOW)).toBeNull();
    expect(parseTokenResponse({ access_token: '' }, NOW)).toBeNull();
  });
});

describe('isTokenValid', () => {
  const NOW = 1_000_000_000_000;

  it('accepts a live token and rejects an expired one', () => {
    expect(isTokenValid({ accessToken: 'AT', refreshToken: null, expiresAt: NOW + 1000 }, NOW)).toBe(true);
    expect(isTokenValid({ accessToken: 'AT', refreshToken: null, expiresAt: NOW - 1000 }, NOW)).toBe(false);
    expect(isTokenValid(null, NOW)).toBe(false);
  });
});

describe('base64UrlEncode', () => {
  it('produces URL-safe output, which Google requires', () => {
    // Standard base64's +, / and = are rejected rather than normalised.
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 255]));

    expect(encoded).not.toMatch(/[+/=]/);
  });
});
