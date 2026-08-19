/**
 * The 4-digit PIN that backs App Lock.
 *
 * Two roles: the only way in on a device with no Face ID / Touch ID / passcode
 * enrolled, and the fallback when biometrics are available but fail or are
 * dismissed. Either way it is the last line, so it is never stored in the app's
 * SQLite database alongside the data it protects — that file is readable from a
 * device backup, and a plaintext PIN there would protect nothing.
 *
 * Instead the PIN is salted, hashed with SHA-256, and the digest kept in the
 * platform keystore (Keychain on iOS, EncryptedSharedPreferences on Android).
 * Verification re-hashes the entered digits and compares digests, so the PIN
 * itself is never written anywhere.
 *
 * A 4-digit space is only 10,000 combinations — trivially brute-forceable if an
 * attacker gets the digest, which is why the salt matters less than the storage
 * location. The keystore is the actual protection; the hash stops a casual read.
 *
 * Both native modules are loaded LAZILY, matching services/biometrics.ts: a
 * top-level import throws at startup on any build that predates them being
 * linked, which would break every screen rather than just this feature.
 */

type SecureStore = typeof import('expo-secure-store');
type Crypto = typeof import('expo-crypto');

const HASH_KEY = 'app_pin_hash';
const SALT_KEY = 'app_pin_salt';

/** Digits a PIN must have. Four is the familiar phone-unlock length. */
export const PIN_LENGTH = 4;

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

/** Hex-encode bytes, for a salt that round-trips through string storage. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPin(pin: string, salt: string): Promise<string | null> {
  const crypto = loadCrypto();
  if (!crypto) return null;
  return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

/** True when a PIN has been set on this device. */
export async function hasPin(): Promise<boolean> {
  const store = loadSecureStore();
  if (!store) return false;
  try {
    return (await store.getItemAsync(HASH_KEY)) !== null;
  } catch {
    return false;
  }
}

/**
 * Store a new PIN, replacing any existing one. Returns false when the native
 * modules are unavailable, so callers can refuse to enable a lock they could
 * never satisfy rather than reporting success.
 */
export async function setPin(pin: string): Promise<boolean> {
  const store = loadSecureStore();
  const crypto = loadCrypto();
  if (!store || !crypto || !isValidPin(pin)) return false;

  try {
    const salt = toHex(await crypto.getRandomBytesAsync(16));
    const digest = await hashPin(pin, salt);
    if (!digest) return false;

    await store.setItemAsync(SALT_KEY, salt);
    await store.setItemAsync(HASH_KEY, digest);
    return true;
  } catch {
    return false;
  }
}

/** Compare an entered PIN against the stored digest. */
export async function verifyPin(pin: string): Promise<boolean> {
  const store = loadSecureStore();
  if (!store) return false;

  try {
    const [salt, expected] = await Promise.all([
      store.getItemAsync(SALT_KEY),
      store.getItemAsync(HASH_KEY),
    ]);
    if (!salt || !expected) return false;

    const digest = await hashPin(pin, salt);
    return digest !== null && digest === expected;
  } catch {
    return false;
  }
}

/** Forget the PIN — used when App Lock is turned off. */
export async function clearPin(): Promise<void> {
  const store = loadSecureStore();
  if (!store) return;
  try {
    await store.deleteItemAsync(HASH_KEY);
    await store.deleteItemAsync(SALT_KEY);
  } catch {
    // Nothing to do: a PIN that cannot be deleted is still unreachable once the
    // lock is off, and throwing here would block the user from disabling it.
  }
}

/** Exactly PIN_LENGTH digits, no spaces or separators. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}
