import { AppState, type AppStateStatus } from 'react-native';

/**
 * When to retry a catalog sync.
 *
 * The app is local-first: nothing here gates a feature, and every caller works
 * fine if this never fires. Its only job is to make sure a device that launched
 * with no signal eventually gets its catalog, without the user having to know
 * anything about it.
 *
 * DELIBERATELY NOT `expo-network`. That module reads the radio directly, which
 * sounds better and is not:
 *
 *   - it needs a native rebuild, so every existing install crashes with
 *     "Cannot find native module 'ExpoNetwork'" until it is reinstalled — this
 *     actually happened here, and a `try/catch` around the `require` does not
 *     catch it because the JS resolves fine and the native side throws later;
 *   - the thing it would save us — skipping a fetch while offline — costs
 *     nothing anyway, since a fetch with no connectivity fails immediately and
 *     silently;
 *   - the case that DOES matter (signal returns after a failed sync) is covered
 *     by foregrounding, because a user who regains signal has almost always
 *     backgrounded the app, locked the phone, or is about to receive another
 *     SMS.
 *
 * `AppState` is part of React Native, so this works on every build with no
 * dependency and no rebuild.
 */

/**
 * Whether a network request is worth attempting.
 *
 * Always true: without a radio API there is nothing to check, and a fetch on a
 * dead connection fails harmlessly in milliseconds. Kept as a named function so
 * the caller reads as intent ("sync if we might be online") and so a real
 * connectivity check can be dropped in later without touching call sites.
 */
export async function isOnline(): Promise<boolean> {
  return true;
}

/**
 * Call `onActive` each time the app returns to the foreground.
 *
 * This is what makes "sync at launch" reliable for someone who opened the app
 * on a train: the launch sync finds no network and gives up, and the next time
 * they open the app — by which point they usually have signal — it retries.
 *
 * Only transitions INTO 'active' fire, so a sync does not run on every
 * incidental state change. Returns an unsubscribe function.
 */
export function onNetworkRestored(onActive: () => void): () => void {
  let previous: AppStateStatus = AppState.currentState;

  const subscription = AppState.addEventListener('change', (next) => {
    // 'background' → 'active' and 'inactive' → 'active' both count; 'active' →
    // 'active' cannot happen, so no guard is needed against repeats.
    if (next === 'active' && previous !== 'active') onActive();
    previous = next;
  });

  return () => subscription.remove();
}
