/**
 * The anonymous identifier a device votes with.
 *
 * The shared catalog needs to know that two corrections came from the same
 * device — otherwise one user confirming "keells" every month would outvote a
 * hundred users who disagree. That is the ONLY thing this id does.
 *
 * It is a random UUID minted on first use, tied to nothing: no account, no
 * phone number, no advertising id, no hardware identifier. Nothing about the
 * user is derivable from it, and the server stores it only as the primary key
 * of a vote row. Losing it (reinstall, cleared keystore) costs the user
 * nothing — they simply vote as a new device.
 *
 * Kept in the platform keystore rather than the SQLite database so it survives
 * a "clear all data" wipe of the board, which stops one device's votes from
 * being counted twice after a reset.
 *
 * Both native modules load LAZILY, matching services/appPin.ts: a top-level
 * import throws at startup on any build predating them being linked, which
 * would break every screen rather than just this feature.
 */

type SecureStore = typeof import('expo-secure-store');
type Crypto = typeof import('expo-crypto');

const DEVICE_ID_KEY = 'shared_catalog_device_id';

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

/** In-memory cache: the keystore read is async and this is hit on every sync. */
let cached: string | null = null;

/**
 * The device's voting id, creating one on first call.
 *
 * Returns null when the keystore is unavailable (an older build, or a platform
 * without one). Callers treat that as "cannot contribute" and skip the upload
 * rather than inventing a per-launch id, which would let a single device stuff
 * the ballot every time the app restarted.
 */
export async function getDeviceId(): Promise<string | null> {
  if (cached) return cached;

  const store = loadSecureStore();
  if (!store) return null;

  try {
    const existing = await store.getItemAsync(DEVICE_ID_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }

    const crypto = loadCrypto();
    if (!crypto) return null;

    const fresh = crypto.randomUUID();
    await store.setItemAsync(DEVICE_ID_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // A keystore failure must never break SMS intake — the sync is optional.
    return null;
  }
}

/**
 * Forget the current id so the next call mints a new one.
 *
 * Exposed for the privacy control in Settings: a user who turns catalog sharing
 * off and on again should not resume their old voting identity.
 */
export async function resetDeviceId(): Promise<void> {
  cached = null;
  const store = loadSecureStore();
  if (!store) return;
  try {
    await store.deleteItemAsync(DEVICE_ID_KEY);
  } catch {
    // Nothing to do — a failed delete leaves the old id, which is harmless.
  }
}
