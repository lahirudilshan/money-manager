import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceRegion, resetDeviceRegionCache } from '../deviceRegion';

/**
 * Reading the device region on a build that may not have the native module.
 *
 * The failure this guards against is specific and was hit before with
 * `expo-web-browser`: an Expo module calls `requireNativeModule` at module
 * scope, so a plain try/catch does NOT stop a missing one from redboxing. The
 * registry is probed first, where nothing can throw.
 *
 * `expo-localization` was added after the current dev client was built, so
 * "module absent" is the state every existing install is in until a rebuild —
 * it must degrade to "ask the user", never crash.
 */

afterEach(() => {
  resetDeviceRegionCache();
  vi.unstubAllGlobals();
});

describe('when the native module is absent', () => {
  it('returns null rather than throwing, with no registry at all', () => {
    // Node/test/web: `globalThis.expo` does not exist.
    expect(() => deviceRegion()).not.toThrow();
    expect(deviceRegion()).toBeNull();
  });

  it('returns null when the registry lacks the module', () => {
    // A dev client built before expo-localization was added.
    vi.stubGlobal('expo', { modules: { ExpoWebBrowser: {} } });
    expect(deviceRegion()).toBeNull();
  });
});

describe('caching', () => {
  it('does not re-probe after a failure', () => {
    // A failing require re-running on every render was the other half of the
    // original bug.
    expect(deviceRegion()).toBeNull();

    // Even with the module now "present", the cached null stands.
    vi.stubGlobal('expo', { modules: { ExpoLocalization: {} } });
    expect(deviceRegion()).toBeNull();
  });

  it('re-reads once the cache is cleared', () => {
    expect(deviceRegion()).toBeNull();
    resetDeviceRegionCache();
    // Still null here (no real module in node), but the read was attempted
    // again rather than served from the cache.
    expect(deviceRegion()).toBeNull();
  });
});
