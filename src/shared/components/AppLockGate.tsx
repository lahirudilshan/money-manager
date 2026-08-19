import React from 'react';
import { AppState, View } from 'react-native';
import { shouldRelockOnResume, shouldTrackAbsence } from '~/shared/lib/lockPolicy';
import { verifyPin } from '~/shared/lib/appPin';
import { canUseBiometrics, confirmWithBiometrics } from '~/shared/lib/biometrics';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '../theme/ThemeProvider';
import { SPLASH_THEME } from './SplashOverlay';
import { PinPad } from './PinPad';
import { Text } from './ui';

/**
 * Holds the app behind the device's own authentication before any screen is
 * rendered.
 *
 * Wraps the navigator rather than living inside a screen: the point is that no
 * balance, account number or merchant name is on screen before the check
 * passes, and a screen-level guard would have already mounted (and briefly
 * painted) the thing it is meant to hide.
 *
 * **One method, not two.** A device with Face ID / Touch ID uses only that, and
 * a failed scan falls through to the phone's own passcode — iOS presents that
 * itself, so there is nothing here to build and nothing extra for the user to
 * remember. The app's 4-digit PIN exists solely for devices with no biometric
 * enrolled, where it is the only way in. Offering both at once meant maintaining
 * a second secret, a setup flow for it, and a recovery flow for when it was
 * forgotten — all to guard the same door the device already guards.
 *
 * **When it asks** is deliberately restrained, and is the whole of
 * `core/lockPolicy.ts`: on a cold start, and on returning from an absence longer
 * than the idle window — NOT on every trip to the background. Prompting on each
 * blur meant checking the bank SMS that produced a draft cost a prompt to get
 * back. It also never locks on `inactive`, which iOS fires for the app switcher,
 * notification banners, and the biometric prompt itself — locking on that is a
 * prompt loop with no way out.
 *
 * **What shows behind the prompt** is deliberately almost nothing: the system
 * sheet is the whole interaction, so the screen under it carries one line near
 * the top and no controls competing with it.
 */
export function AppLockGate({
  children,
  onUnlocked,
  onWaiting,
}: {
  children: React.ReactNode;
  /**
   * Fired when the gate opens — on a successful unlock, or immediately when the
   * lock is off. Lets the splash overlay outside this component know it may
   * stop covering, so the brand hands off to a painted screen rather than to a
   * half-drawn one.
   */
  onUnlocked?: () => void;
  /**
   * True while this gate is closed on a biometric device, i.e. the system sheet
   * is up and the surface above should stay blank. False when there is nothing
   * to wait for — lock off, already unlocked, or a PIN device, which draws its
   * own keypad.
   */
  onWaiting?: (waiting: boolean) => void;
}) {
  const { colors, mode, space } = useTheme();
  // The holding screens sit directly under the splash, so they share its canvas.
  const splashCanvas = SPLASH_THEME[mode === 'dark' ? 'dark' : 'light'].canvas;
  const enabled = useAppStore((s) => s.appLockEnabled);
  const ready = useAppStore((s) => s.ready);

  const [unlocked, setUnlocked] = React.useState(false);
  const [prompting, setPrompting] = React.useState(false);
  /**
   * Whether this device authenticates by scan or by the app's PIN. Null until
   * the capability check resolves, which is why nothing is rendered before then
   * — guessing wrong would flash the wrong lock screen on every launch.
   */
  const [method, setMethod] = React.useState<'biometric' | 'pin' | null>(null);
  const [pin, setPin] = React.useState('');
  const [pinError, setPinError] = React.useState<string | null>(null);
  /** Set when a scan failed or was dismissed, so a retry can be offered. */
  const [scanFailed, setScanFailed] = React.useState(false);

  /**
   * When the app last genuinely went to the background. A ref, not state: it is
   * read inside the AppState listener and must never re-arm that subscription.
   */
  const backgroundedAt = React.useRef<number | null>(null);

  /**
   * True while the system biometric sheet is up.
   *
   * On iOS that sheet backgrounds the app, so without this the prompt's own
   * absence is recorded as the user leaving — and a sheet left sitting longer
   * than the idle window would re-lock the app *underneath* a successful
   * authentication. A ref rather than the `prompting` state because the
   * AppState listener closes over its value and must see it without re-arming.
   */
  const promptInFlight = React.useRef(false);

  // Decide once which method this device uses. A biometric wins whenever one is
  // actually enrolled; otherwise the app's PIN is the only way in.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const canScan = await canUseBiometrics();
      if (cancelled) return;
      setMethod(canScan ? 'biometric' : 'pin');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runBiometrics = React.useCallback(async () => {
    setPrompting(true);
    // Set before the sheet can appear and cleared only in `finally`, so the
    // whole time the app may be backgrounded by the prompt is covered.
    promptInFlight.current = true;
    try {
      /*
       * `biometricOnly: false` — the opposite of the previous design, and the
       * point of this one. A failed or unavailable scan hands off to the
       * *device passcode*, which iOS presents itself. That is the fallback the
       * user already knows, so the app needs no second secret of its own.
       */
      const ok = await confirmWithBiometrics('Unlock Money Manager');
      if (ok) {
        setUnlocked(true);
        setScanFailed(false);
        // Cleared on success so a later resume measures from the next real
        // background, not from an absence already paid for.
        backgroundedAt.current = null;
      } else {
        // Dismissed or failed outright (including a cancelled passcode sheet).
        // Not an error — offer the retry rather than stranding a blank screen.
        setScanFailed(true);
      }
    } finally {
      setPrompting(false);
      promptInFlight.current = false;
      backgroundedAt.current = null;
    }
  }, []);

  /*
   * Prompt as soon as the store is ready, the lock is on, and the device's
   * method is known. PIN devices simply show their keypad instead.
   *
   * **`ready` is checked before `enabled`, and that order is the whole bug this
   * guards.** `appLockEnabled` starts `false` in the store and only becomes true
   * once `refresh()` has read it back from SQLite. Testing `enabled` first meant
   * the very first render — before the database had been opened — looked exactly
   * like "the lock is off", so this set `unlocked = true` permanently and no
   * later value could undo it. The app opened straight to the dashboard with the
   * lock switched on and no prompt ever fired.
   */
  React.useEffect(() => {
    // Nothing is known yet; decide nothing.
    if (!ready) return;

    if (!enabled) {
      setUnlocked(true);
      return;
    }
    if (unlocked || prompting || method !== 'biometric' || scanFailed) return;

    void runBiometrics();
    // `prompting` is deliberately absent: including it would re-run this when
    // the prompt closes and immediately re-prompt on a cancelled attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, unlocked, method, scanFailed, runBiometrics]);

  /**
   * Re-lock only after a real absence.
   *
   * `background` marks when the app left; the decision is made on the way back
   * in, so a quick round trip costs nothing and a long one re-locks. `inactive`
   * is ignored entirely — see the note on the component.
   */
  React.useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (next) => {
      // The biometric sheet backgrounds the app on iOS. That is the lock doing
      // its job, not the user leaving, so neither half of the pair counts.
      if (!shouldTrackAbsence(promptInFlight.current)) return;

      if (next === 'background') {
        // Only the first background of an absence counts; iOS can emit more.
        backgroundedAt.current ??= Date.now();
        return;
      }

      if (next === 'active') {
        /*
         * Clear a failed scan on every return to the foreground.
         *
         * With no retry button on screen any more, `scanFailed` would otherwise
         * be a dead end: the prompt effect refuses to fire while it is set, so
         * a cancelled Face ID left the app on a blank canvas with no way
         * forward. Coming back to the app is the natural "try again" gesture,
         * and iOS backgrounds the app for the sheet anyway.
         */
        setScanFailed(false);

        if (shouldRelockOnResume(backgroundedAt.current, Date.now())) {
          setUnlocked(false);
          setPin('');
          setPinError(null);
          // A new lock is a fresh attempt, so the auto-prompt fires again.
          setScanFailed(false);
        }
        // Either way the absence is settled: a stay short enough to keep the
        // session must not accumulate toward the next resume's decision.
        backgroundedAt.current = null;
      }
    });

    return () => subscription.remove();
  }, [enabled]);

  /*
   * Report the gate being open, from one place rather than from each of the
   * three routes in (biometric success, correct PIN, lock switched off). Those
   * all converge on `unlocked`, so watching it cannot miss a case — and being an
   * effect it fires after the state settles, which is when the claim is true.
   *
   * `ready` gates it for the third time in this file, and for the same reason:
   * `enabled` is `false` until SQLite answers, so `!enabled` is momentarily true
   * even when the lock is on. Without this the gate announced itself open on the
   * first render — before prompting — and the splash mounted over the Face ID
   * sheet instead of after it.
   */
  const gateOpen = ready && (!enabled || unlocked);
  React.useEffect(() => {
    if (gateOpen) onUnlocked?.();
  }, [gateOpen, onUnlocked]);

  /*
   * Publish whether this gate is holding the screen. The surface above draws
   * nothing while true, so the system sheet is the only thing the user sees.
   */
  const waitingOnBiometric = ready && enabled && !unlocked && method === 'biometric';
  React.useEffect(() => {
    onWaiting?.(waitingOnBiometric);
  }, [waitingOnBiometric, onWaiting]);

  async function submitPin(entered: string) {
    if (await verifyPin(entered)) {
      setUnlocked(true);
      backgroundedAt.current = null;
      setPin('');
      setPinError(null);
      return;
    }
    setPinError('Wrong PIN');
    setPin('');
  }

  /*
   * Hold a blank canvas until the store has been read.
   *
   * `enabled` is `false` until SQLite answers, so returning `children` on that
   * alone would paint the dashboard for a frame or two before the lock screen
   * appeared — showing the balances the lock exists to hide. Waiting costs a
   * frame of background colour and is the whole point of the component.
   */
  if (!ready) return <View style={{ flex: 1, backgroundColor: splashCanvas }} />;

  if (!enabled || unlocked) return <>{children}</>;

  // Nothing until the capability check resolves — a flash of the wrong lock
  // screen on every launch is worse than a frame of the background colour.
  if (method === null) return <View style={{ flex: 1, backgroundColor: splashCanvas }} />;

  /*
   * A biometric device renders NOTHING here.
   *
   * The splash overlay above this gate is the one surface the user sees during
   * launch: it shows a status line while the system sheet is up, then plays the
   * brand once authentication succeeds. Rendering a second lock screen behind
   * it meant two components racing over the same moment, which is where every
   * ordering bug in this flow came from. The gate reports its state through
   * `onWaiting` and lets that single surface do the drawing.
   */
  if (method === 'biometric') return null;

  /*
   * PIN devices only: no biometric is enrolled, so these digits are the single
   * way in. There is no "use Face ID instead" here because there is no Face ID.
   */
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xl,
        padding: space.xl,
        backgroundColor: colors.canvas,
      }}
    >
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Text variant="heading">Money Manager</Text>
        <Text variant="small" tone="muted">
          Enter your PIN to unlock
        </Text>
      </View>

      <PinPad
        value={pin}
        onChange={(next) => {
          setPin(next);
          if (pinError) setPinError(null);
        }}
        onComplete={(entered) => void submitPin(entered)}
        error={pinError}
      />
    </View>
  );
}
