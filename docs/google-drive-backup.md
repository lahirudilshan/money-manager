# Google Drive backup — setup

**Status: configured.** The client id is set in `app.json` and the reversed-id
URL scheme is registered. One native rebuild is still required before sign-in
works on a device — see step 3.

```
CLIENT_ID   486010862889-aaps2ikec9a1aigbei98varil468mn9f.apps.googleusercontent.com
BUNDLE_ID   com.anonymous.moneymanager
SCHEME      com.googleusercontent.apps.486010862889-aaps2ikec9a1aigbei98varil468mn9f
```

The steps below record how this was set up, and what to change if the project
ever moves to a different Google client.

If `expo.extra.googleClientId` is ever emptied, `isDriveAvailable()` returns
false and the screen shows the Google row locked with an explanation, rather
than throwing at sign-in.

## 1. Create the OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create (or pick) a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **Credentials → Create credentials → OAuth client ID**.
4. Application type: **iOS**.
5. Bundle ID: `com.anonymous.moneymanager` — must match
   `expo.ios.bundleIdentifier` in `app.json` exactly.

Google issues a client id like `123456-abcdef.apps.googleusercontent.com`.
**iOS clients have no client secret** — that is expected, not something missing.
The redirect URI is tied to the bundle id, which is what makes the flow safe
without one (see `src/core/googleAuth.ts` for why PKCE is used).

## 2. Configure the app

In `app.json`:

```jsonc
{
  "expo": {
    "extra": {
      "googleClientId": "123456-abcdef.apps.googleusercontent.com"
    },
    "ios": {
      "infoPlist": {
        "CFBundleURLTypes": [
          {
            // The REVERSED client id. Google's iOS clients redirect here and
            // will reject anything else, including the app's own
            // `moneymanager://` scheme.
            "CFBundleURLSchemes": ["com.googleusercontent.apps.123456-abcdef"]
          }
        ]
      }
    }
  }
}
```

The scheme is the client id with its two halves swapped — `redirectUriFor()`
derives the same string, so if they disagree the redirect never arrives and
sign-in hangs on the browser screen.

## 3. Rebuild

Two things need native code, so a rebuild is required before sign-in works:

- **`CFBundleURLTypes`** — a native Info.plist key, so the redirect scheme is
  only registered after a prebuild.
- **`expo-web-browser`** — provides `ASWebAuthenticationSession`, the sheet the
  sign-in is presented in. Autolinked, but only into a fresh binary.

```sh
yarn prebuild:ios && yarn ios:device
```

Until then the backup screen shows the Google row as
*"Ready — rebuild the app to switch this on"*, which distinguishes a
missing binary from a missing client id (see `driveBlocker()`).

### Why a sheet, not a browser switch or a WebView

Sign-in uses `WebBrowser.openAuthSessionAsync`, which on iOS is
`ASWebAuthenticationSession`. It is the only option with all three properties:

| | Safari switch | **Auth sheet** | WebView |
|---|---|---|---|
| Reuses the user's Google session | yes | **yes** | no — isolated cookies |
| App stays on screen | no | **yes** | yes |
| Permitted by Google | yes | **yes** | no — `disallowed_useragent` |

`preferEphemeralSession: false` is deliberate: it is what lets the sheet reuse
Safari's cookies, so an already-signed-in user taps "Continue as …" once rather
than typing a password.

## 4. Consent screen

While the app is in **Testing** mode, only accounts listed under
**OAuth consent screen → Test users** can sign in. Add your own Google account
there or sign-in fails with `access_denied`.

The requested scope is `drive.file`, which grants access **only to files this
app created** — it cannot read anything else in the user's Drive. Google treats
that as a non-sensitive scope, so it needs no verification review.

## What it does once configured

- Signing in uploads a backup immediately (no second button to hunt for).
- Backups go to a visible **`money-manager`** folder in the user's Drive, created
  on first upload.
- The last upload time is stored locally (`SETTINGS_KEYS.lastCloudBackupAt`) so
  the screen can say "Backed up 2 hours ago" without a network round trip.
- The refresh token lives in the **keystore**, never the database — the database
  is included in backups, and a live credential inside a shared backup file would
  be a real leak.
