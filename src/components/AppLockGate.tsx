import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { AppState, Pressable, View } from 'react-native';
import { hasPin, verifyPin } from '../services/appPin';
import { canAuthenticate, confirmWithBiometrics } from '../services/biometrics';
import { useAppStore } from '../store/useAppStore';
import { useTheme } from '../theme/ThemeProvider';
import { PinPad } from './PinPad';
import { Button, T } from './ui';

/**
 * Holds the app behind Face ID / Touch ID / passcode — or a 4-digit PIN — when
 * the user has asked for it, before any screen is rendered.
 *
 * Wraps the navigator rather than living inside a screen: the point is that no
 * balance, account number or merchant name is on screen before the check
 * passes, and a screen-level guard would have already mounted (and briefly
 * painted) the thing it is meant to hide.
 *
 * Biometrics are tried first when enrolled, with the PIN as the fallback for a
 * failed or dismissed prompt. On a device with no biometrics the PIN is the only
 * route in, which is why Settings will not let the lock be enabled without one.
 *
 * Re-locks when the app returns from the background, so handing an unlocked
 * phone to someone does not hand them the ledger. It deliberately does NOT lock
 * on every blur — the biometric prompt itself backgrounds the app on iOS, and
 * locking on that would leave the user in a prompt loop they cannot escape.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { colors, space } = useTheme();
  const enabled = useAppStore((s) => s.appLockEnabled);
  const ready = useAppStore((s) => s.ready);

  const [unlocked, setUnlocked] = React.useState(false);
  const [prompting, setPrompting] = React.useState(false);
  /** Shown instead of the biometric button once the user falls back to digits. */
  const [showPin, setShowPin] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const [pinError, setPinError] = React.useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = React.useState(false);

  const runBiometrics = React.useCallback(async () => {
    setPrompting(true);
    try {
      const available = await canAuthenticate();
      setBiometricsAvailable(available);

      // `confirmWithBiometrics` resolves true when nothing is enrolled so the
      // rest of the app degrades gracefully — here that would defeat the lock,
      // so an unavailable device goes straight to the PIN instead.
      if (!available) {
        setShowPin(true);
        return;
      }

      const ok = await confirmWithBiometrics('Unlock Money Manager');
      if (ok) setUnlocked(true);
      // A dismissed prompt is not an error: the user may simply prefer digits,
      // and the PIN entry is already on screen behind this.
      else setShowPin(await hasPin());
    } finally {
      setPrompting(false);
    }
  }, []);

  // Prompt as soon as the store is ready and the lock is on.
  React.useEffect(() => {
    if (!enabled) {
      setUnlocked(true);
      return;
    }
    if (ready && !unlocked && !prompting && !showPin) void runBiometrics();
    // `prompting` is deliberately absent: including it would re-run this when
    // the prompt closes and immediately re-prompt on a cancelled attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, unlocked, showPin, runBiometrics]);

  // Re-lock on return from the background.
  React.useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (next) => {
      // Only 'background' — not 'inactive', which fires for the biometric
      // prompt, the app switcher preview and a notification banner.
      if (next === 'background') {
        setUnlocked(false);
        setShowPin(false);
        setPin('');
        setPinError(null);
      }
    });

    return () => subscription.remove();
  }, [enabled]);

  async function submitPin(entered: string) {
    const ok = await verifyPin(entered);
    if (ok) {
      setUnlocked(true);
      setPin('');
      setPinError(null);
      return;
    }
    setPinError('Wrong PIN');
    setPin('');
  }

  if (!enabled || unlocked) return <>{children}</>;

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
      <View style={{ alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentSoft,
          }}
        >
          <Ionicons name="lock-closed" size={28} color={colors.accent} />
        </View>
        <T variant="heading">Locked</T>
        {!showPin ? (
          <T variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
            Unlock with Face ID, Touch ID or your passcode.
          </T>
        ) : null}
      </View>

      {showPin ? (
        <>
          <PinPad
            value={pin}
            onChange={(next) => {
              setPin(next);
              if (pinError) setPinError(null);
            }}
            onComplete={(entered) => void submitPin(entered)}
            error={pinError}
          />

          {/* Only offered when biometrics could actually succeed — on a device
              without them this would be a button that reopens a failed path. */}
          {biometricsAvailable ? (
            <Pressable
              onPress={() => {
                setShowPin(false);
                setPin('');
                setPinError(null);
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                Use Face ID instead
              </T>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={{ gap: space.md, alignItems: 'center' }}>
          <Button
            label={prompting ? 'Waiting…' : 'Unlock'}
            icon="finger-print"
            onPress={() => void runBiometrics()}
            disabled={prompting}
          />
          <Pressable
            onPress={() => void hasPin().then((exists) => exists && setShowPin(true))}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
              Enter PIN instead
            </T>
          </Pressable>
        </View>
      )}
    </View>
  );
}
