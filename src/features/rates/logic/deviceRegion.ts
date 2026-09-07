/**
 * The device's region, read safely on a build that may not have the module.
 *
 * ## Why the probe
 *
 * `expo-localization` calls `requireNativeModule` at MODULE SCOPE, and Metro
 * evaluates that outside the caller's stack — so a plain `try/catch` around the
 * `require` does NOT catch a missing native module. It surfaces as an uncaught
 * redbox instead. That was learned the hard way adding `expo-web-browser`, and
 * it matters here because the module was added AFTER the current dev client was
 * built: every existing install lacks it until the next `prebuild`.
 *
 * So the registry is probed first, where nothing can throw, and the wrapper is
 * only required once it is known to be present.
 *
 * A missing module is not an error. It means "we cannot guess the region", the
 * same answer as an unrecognised one, and the caller falls back to asking.
 */

/** `undefined` = not tried yet, `null` = unavailable. Cached so a failing
 *  require does not re-run on every render. */
let cached: string | null | undefined;

/**
 * The device's ISO region ("AU", "LK"), or null when it cannot be determined.
 *
 * Null covers three cases the caller treats identically — no native module, no
 * region set on the device, and a region the platform reports in a shape we do
 * not recognise. All three mean "ask the user", never "assume".
 */
export function deviceRegion(): string | null {
  if (cached !== undefined) return cached;

  cached = read();
  return cached;
}

function read(): string | null {
  try {
    const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo
      ?.modules;
    // No registry at all means we are outside a native runtime (a test, or
    // web); no entry means the dev client predates the module being added.
    if (!registry || !registry.ExpoLocalization) return null;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const localization = require('expo-localization') as {
      getLocales?: () => { regionCode?: string | null }[];
    };

    const locales = localization.getLocales?.() ?? [];
    for (const locale of locales) {
      const region = locale?.regionCode?.trim();
      if (region) return region.toUpperCase();
    }
    return null;
  } catch {
    // Belt and braces: the probe above should make this unreachable, but a
    // guess about the region is never worth a crash on launch.
    return null;
  }
}

/** Reset the cache. Tests only — the real value cannot change at runtime. */
export function resetDeviceRegionCache(): void {
  cached = undefined;
}
