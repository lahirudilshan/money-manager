/**
 * Thin wrapper over expo-local-authentication for gating destructive actions
 * (currently "Clear all data") behind Face ID / Touch ID, falling back to the
 * device passcode. Kept isolated so the one native dependency has a single,
 * easily-mocked seam.
 *
 * The native module is loaded LAZILY (via require, inside the functions) rather
 * than a top-level import: a top-level import throws at app startup on any build
 * that predates the module being linked (e.g. before a fresh dev build), which
 * would crash every screen. Loading on first use keeps the rest of the app
 * working and degrades gracefully to "allowed" when the module is absent.
 */

type LocalAuth = typeof import('expo-local-authentication');

function loadModule(): LocalAuth | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-local-authentication') as LocalAuth;
  } catch {
    return null;
  }
}

/** Whether the device can authenticate — module present, hardware, and enrolled. */
export async function canAuthenticate(): Promise<boolean> {
  const mod = loadModule();
  if (!mod) return false;
  try {
    const hasHardware = await mod.hasHardwareAsync();
    const enrolled = await mod.isEnrolledAsync();
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

/**
 * What the device would actually ask for — "Face ID", "Touch ID", or "" when
 * nothing is enrolled. Used to label the App Lock setting with the one method
 * the user will see, rather than listing every possibility on every device.
 */
export async function describeBiometric(): Promise<string> {
  const mod = loadModule();
  if (!mod) return '';

  try {
    if (!(await canAuthenticate())) return '';
    const types = await mod.supportedAuthenticationTypesAsync();

    if (types.includes(mod.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
    if (types.includes(mod.AuthenticationType.FINGERPRINT)) return 'Touch ID';
    if (types.includes(mod.AuthenticationType.IRIS)) return 'Iris';
    return 'Biometrics';
  } catch {
    return '';
  }
}

/**
 * Prompt for biometric (or passcode) confirmation. Returns true on success. If
 * the module is missing or the device has nothing enrolled, returns true so the
 * app stays usable — callers that must hard-block should check
 * `canAuthenticate()` first.
 */
export async function confirmWithBiometrics(reason: string): Promise<boolean> {
  const mod = loadModule();
  if (!mod) return true;

  const available = await canAuthenticate();
  if (!available) return true;

  const result = await mod.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });
  return result.success;
}
