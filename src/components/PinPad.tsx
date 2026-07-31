import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import * as Haptics from 'expo-haptics';
import { Animated, Pressable, useWindowDimensions, View } from 'react-native';
import { PIN_LENGTH } from '../services/appPin';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './ui';

/**
 * A 4-digit PIN entry pad — dots showing progress, then a numeric keypad.
 *
 * Its own keypad rather than a `TextInput` with `keyboardType="number-pad"`:
 * the system keyboard can be dismissed, covers half the screen, and on the lock
 * screen would leave the user staring at a field with no way to bring it back.
 * Fixed keys are always present and always the same size.
 *
 * The parent owns the value. This calls `onComplete` the moment the last digit
 * lands, so no "submit" key is needed.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  onBiometricPress,
  biometricIcon,
  biometricLabel,
  footer,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the value reaches PIN_LENGTH. */
  onComplete: (pin: string) => void;
  /** Shown under the dots; also tints them, for a wrong entry. */
  error?: string | null;
  disabled?: boolean;
  /**
   * Return to Face ID / Touch ID from the keypad. Omit on screens where there
   * is no biometric to go back to (PIN *setup*, or a device without one) — the
   * key is then an empty cell rather than a button that leads nowhere.
   */
  onBiometricPress?: () => void;
  /** Glyph for that key — matches the device's actual method. */
  biometricIcon?: keyof typeof Ionicons.glyphMap;
  /** Accessible name for it, e.g. "Use Face ID". */
  biometricLabel?: string;
  /**
   * Optional content under the keypad — the "forgot PIN" escape. A slot rather
   * than a fixed prop because what belongs there differs by screen: the lock
   * screen offers recovery, PIN setup offers "start over", and neither should
   * inherit the other's action.
   */
  footer?: React.ReactNode;
}) {
  const { colors, radius, space } = useTheme();
  const keySize = useKeySize();

  /** Horizontal offset for the wrong-PIN shake. */
  const shake = React.useRef(new Animated.Value(0)).current;

  // Shake whenever a new error arrives. Driven off the prop rather than the
  // submit handler so it fires for any failure the parent reports, including
  // ones that resolve asynchronously (verifyPin hashes before it can answer).
  React.useEffect(() => {
    if (!error) return;

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {
      // Haptics are a nicety; a device without them must not break entry.
    });

    Animated.sequence(
      [8, -8, 6, -6, 0].map((toValue) =>
        Animated.timing(shake, {
          toValue,
          duration: 55,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [error, shake]);

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;

    // A keypad with no travel needs *some* confirmation that the tap landed;
    // this is the same feedback the system passcode screen gives.
    void Haptics.selectionAsync().catch(() => {});

    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete(next);
  };

  const backspace = () => {
    if (disabled || value.length === 0) return;
    void Haptics.selectionAsync().catch(() => {});
    onChange(value.slice(0, -1));
  };

  return (
    <View style={{ gap: space.xl, alignItems: 'center' }}>
      {/* Progress dots — filled as digits land, tinted red on a bad attempt.
          The row shakes on error, which is the one piece of feedback people
          already read as "wrong, try again" without stopping to parse text. */}
      <View style={{ gap: space.sm, alignItems: 'center' }}>
        <Animated.View
          style={{ flexDirection: 'row', gap: space.md, transform: [{ translateX: shake }] }}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, index) => {
            const filled = index < value.length;
            return (
              <Animated.View
                key={index}
                style={{
                  // Filled dots swell slightly, so each keypress registers
                  // visually as well as by the dot changing colour.
                  width: 15,
                  height: 15,
                  borderRadius: 8,
                  borderWidth: filled ? 0 : 1.5,
                  borderColor: colors.hairlineStrong,
                  backgroundColor: filled
                    ? error
                      ? colors.danger
                      : colors.accent
                    : 'transparent',
                  transform: [{ scale: filled ? 1.12 : 1 }],
                }}
              />
            );
          })}
        </Animated.View>

        {/* Reserve the line's height so the pad does not jump when an error
            appears — a shifting keypad under the thumb is easy to mis-tap. */}
        <Text
          variant="caption"
          color={error ? colors.danger : 'transparent'}
          style={{ fontWeight: '600' }}
        >
          {error ?? 'placeholder'}
        </Text>
      </View>

      <View style={{ gap: space.sm }}>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ].map((row) => (
          <View key={row.join()} style={{ flexDirection: 'row', gap: space.sm }}>
            {row.map((digit) => (
              <Key
                key={digit}
                label={digit}
                size={keySize}
                onPress={() => press(digit)}
                disabled={disabled}
              />
            ))}
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {/* Bottom-left: the way back to Face ID when it is on offer, exactly
              where the system passcode screen puts it. Falls back to an empty
              cell (keeping 0 centred under 8, as on a dialler) when there is no
              biometric to return to. */}
          {onBiometricPress ? (
            <Pressable
              onPress={onBiometricPress}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={biometricLabel ?? 'Use biometrics'}
              style={({ pressed }) => ({
                width: keySize,
                height: keySize,
                borderRadius: keySize / 2,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
              })}
            >
              <Ionicons
                name={biometricIcon ?? 'finger-print'}
                size={26}
                color={colors.accent}
              />
            </Pressable>
          ) : (
            <View style={{ width: keySize }} />
          )}
          <Key label="0" size={keySize} onPress={() => press('0')} disabled={disabled} />
          <Pressable
            onPress={backspace}
            disabled={disabled || value.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            style={({ pressed }) => ({
              width: keySize,
              height: keySize,
              borderRadius: keySize / 2,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: value.length === 0 ? 0.3 : pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="backspace-outline" size={24} color={colors.inkSecondary} />
          </Pressable>
        </View>
      </View>

      {/* Height reserved whether or not it is filled, so the keypad above never
          shifts under the thumb when the escape appears mid-entry. */}
      <View style={{ minHeight: 22, alignItems: 'center', justifyContent: 'center' }}>
        {footer}
      </View>
    </View>
  );
}

/**
 * Key diameter, sized from the current window rather than fixed.
 *
 * A hard 72pt worked on a Pro but crowded the edges of a small phone, where
 * three keys plus their gaps overflowed the sheet's padding. Deriving it from
 * the window keeps the same generous target on a large device and shrinks it
 * only as far as it must — clamped so it can never fall below a comfortably
 * tappable size or grow into a novelty on a tablet.
 *
 * A hook, deliberately, not a module-level `Dimensions.get()` constant: that is
 * evaluated once at import and so is wrong after a rotation, in split view, or
 * on any device whose window changes after launch. It also makes the module's
 * first render depend on a native module being ready at import time.
 */
function useKeySize(): number {
  const { width } = useWindowDimensions();
  // 88 = the sheet's horizontal padding plus the two gaps between three keys.
  return Math.round(Math.max(60, Math.min(78, (width - 88) / 3)));
}

function Key({
  label,
  size,
  onPress,
  disabled,
}: {
  label: string;
  /** Diameter, from the parent's `useKeySize` so every key matches the layout. */
  size: number;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: size,
        height: size,
        // Fully round, as on every system passcode screen — the shape is part of
        // what makes a keypad read as a keypad at a glance.
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.accentSoft : colors.surfaceSunken,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text style={{ fontSize: 28, fontWeight: '500', color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}
