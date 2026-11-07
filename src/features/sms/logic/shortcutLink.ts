/**
 * Which iCloud link "Add automation" opens.
 *
 * A shared shortcut is bound to the app's bundle id (its action is
 * `<bundleId>.SendMessageToDaylyIntent`), so a rename or a rebuilt automation
 * means a new link. Shipping the link in the bundle made every such change an
 * app release, and in between the button handed out a shortcut iOS shows as
 * "turned off". So the live link comes from `GET /api/config`, is cached in
 * settings, and the constant below is only the floor for a first launch with
 * no network.
 */

/** Built-in link: used until the server has answered once. */
export const DEFAULT_SHORTCUT_URL = 'https://www.icloud.com/shortcuts/d95ccb33eadc41988a6b2fab7ca16a42';

/**
 * True for `https://www.icloud.com/shortcuts/<hex id>` and nothing else.
 *
 * The value comes off the network and goes straight into `Linking.openURL`, so
 * it is held to the one shape a shared shortcut has. A typo in the database, or
 * a hijacked response, then costs nothing: the app keeps its last good link
 * rather than opening an arbitrary URL.
 */
export function isShortcutLink(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/.test(value.trim());
}

/** The link to open: the cached server value when valid, else the built-in one. */
export function resolveShortcutUrl(cached: string | undefined | null): string {
  return isShortcutLink(cached) ? cached.trim() : DEFAULT_SHORTCUT_URL;
}
