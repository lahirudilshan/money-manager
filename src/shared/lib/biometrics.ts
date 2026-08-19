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

import { Platform } from 'react-native';

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
 * Whether a real *biometric* (face/fingerprint/iris) is enrolled — as opposed to
 * only a device passcode, which `canAuthenticate` also accepts.
 *
 * The distinction matters for the App Lock toggle. `isEnrolledAsync` reports
 * true on a phone that merely has a passcode set, so gating the "Unlock with
 * Face ID" switch on `canAuthenticate` alone would offer biometrics on a device
 * that has none and then fall through to a passcode prompt — which is what the
 * unlock screen is meant to avoid. `SecurityLevel.BIOMETRIC*` is the honest
 * signal, with the supported-types list as the fallback on older runtimes that
 * do not report a level.
 */
export async function canUseBiometrics(): Promise<boolean> {
  const mod = loadModule();
  if (!mod) return false;

  try {
    if (!(await mod.hasHardwareAsync())) return false;
    if (!(await mod.isEnrolledAsync())) return false;

    /*
     * `SecurityLevel` gained BIOMETRIC_STRONG/WEAK in SDK 50 and deprecated the
     * old `BIOMETRIC`. Reading the deprecated key logs a warning on every call,
     * so it is omitted — and omitting it costs nothing, because the deprecated
     * member shares its numeric value (2) with BIOMETRIC_WEAK. A runtime old
     * enough to only have `BIOMETRIC` still matches on that same number.
     */
    const level = await mod.getEnrolledLevelAsync();
    const biometricLevels = [
      (mod.SecurityLevel as Record<string, unknown>).BIOMETRIC_STRONG,
      (mod.SecurityLevel as Record<string, unknown>).BIOMETRIC_WEAK,
    ].filter((value) => value !== undefined);

    if (biometricLevels.length > 0) return biometricLevels.includes(level);

    // No usable level enum — fall back to "the device names a scanner type".
    const types = await mod.supportedAuthenticationTypesAsync();
    return types.length > 0;
  } catch {
    return false;
  }
}

/**
 * What the device would actually ask for — "Face ID", "Fingerprint", "Iris", or
 * "" when nothing is enrolled. Used to label the App Lock setting with the one
 * method the user will see, rather than listing every possibility on every
 * device.
 *
 * **Apple's names are only used on Apple hardware.** "Touch ID" and "Face ID"
 * are Apple trademarks for Apple sensors; returning "Touch ID" for an Android
 * fingerprint reader — which the previous version did — names a thing that
 * phone does not have. Android gets the generic term its own OS uses.
 */
export async function describeBiometric(): Promise<string> {
  const mod = loadModule();
  if (!mod) return '';

  try {
    if (!(await canAuthenticate())) return '';
    const types = await mod.supportedAuthenticationTypesAsync();
    const apple = Platform.OS === 'ios';

    // Face first: on a device with both, the face sensor is what iOS presents.
    if (types.includes(mod.AuthenticationType.FACIAL_RECOGNITION)) {
      return apple ? 'Face ID' : 'Face unlock';
    }
    if (types.includes(mod.AuthenticationType.FINGERPRINT)) {
      return apple ? 'Touch ID' : 'Fingerprint';
    }
    if (types.includes(mod.AuthenticationType.IRIS)) return 'Iris';
    return 'Biometrics';
  } catch {
    return '';
  }
}

/**
 * Prompt for biometric confirmation. Returns true on success. If the module is
 * missing or the device has nothing enrolled, returns true so the app stays
 * usable — callers that must hard-block should check `canAuthenticate()` first.
 *
 * `biometricOnly` decides what happens when the face/finger scan fails or is
 * unavailable:
 *
 *  - **true** (the unlock path): only Face ID / Touch ID is offered. iOS will
 *    NOT silently substitute the device passcode, because this app has its own
 *    PIN as the fallback and asking for the *phone's* passcode to open a
 *    budgeting app is both a worse experience and a wider grant than needed.
 *  - **false** (destructive actions like erasing data): the device passcode is
 *    allowed, since there is no in-app fallback there and being locked out of
 *    the confirmation would be worse than the extra breadth.
 *
 * Note: Face ID only ever appears if `NSFaceIDUsageDescription` is present in
 * Info.plist. Without it iOS quietly downgrades every call to a passcode
 * prompt, which looks exactly like biometrics being broken — see app.json.
 */
export async function confirmWithBiometrics(
  reason: string,
  { biometricOnly = false }: { biometricOnly?: boolean } = {},
): Promise<boolean> {
  const mod = loadModule();
  if (!mod) return true;

  const available = await canAuthenticate();
  if (!available) return true;

  const result = await mod.authenticateAsync({
    promptMessage: reason,
    // When true, a failed scan surfaces as a failure this app handles (by
    // showing its own PIN pad) rather than iOS taking over with a passcode.
    disableDeviceFallback: biometricOnly,
    cancelLabel: 'Cancel',
    // Naming the in-app alternative makes the fallback button say where it
    // goes, instead of the default "Enter Password".
    ...(biometricOnly ? { fallbackLabel: 'Use PIN' } : {}),
  });
  return result.success;
}
