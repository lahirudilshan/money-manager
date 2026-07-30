import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { PIN_LENGTH } from '../services/appPin';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

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
}: {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the value reaches PIN_LENGTH. */
  onComplete: (pin: string) => void;
  /** Shown under the dots; also tints them, for a wrong entry. */
  error?: string | null;
  disabled?: boolean;
}) {
  const { colors, radius, space } = useTheme();

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete(next);
  };

  const backspace = () => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  return (
    <View style={{ gap: space.xl, alignItems: 'center' }}>
      {/* Progress dots — filled as digits land, tinted red on a bad attempt. */}
      <View style={{ gap: space.sm, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => {
            const filled = index < value.length;
            return (
              <View
                key={index}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  borderWidth: filled ? 0 : 1.5,
                  borderColor: colors.hairlineStrong,
                  backgroundColor: filled
                    ? error
                      ? colors.danger
                      : colors.accent
                    : 'transparent',
                }}
              />
            );
          })}
        </View>

        {/* Reserve the line's height so the pad does not jump when an error
            appears — a shifting keypad under the thumb is easy to mis-tap. */}
        <T
          variant="caption"
          color={error ? colors.danger : 'transparent'}
          style={{ fontWeight: '600' }}
        >
          {error ?? 'placeholder'}
        </T>
      </View>

      <View style={{ gap: space.sm }}>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ].map((row) => (
          <View key={row.join()} style={{ flexDirection: 'row', gap: space.sm }}>
            {row.map((digit) => (
              <Key key={digit} label={digit} onPress={() => press(digit)} disabled={disabled} />
            ))}
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {/* Empty cell keeps 0 centred under 8, as on a phone dialler. */}
          <View style={{ width: KEY_SIZE }} />
          <Key label="0" onPress={() => press('0')} disabled={disabled} />
          <Pressable
            onPress={backspace}
            disabled={disabled || value.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            style={({ pressed }) => ({
              width: KEY_SIZE,
              height: KEY_SIZE,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: value.length === 0 ? 0.3 : pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="backspace-outline" size={22} color={colors.inkSecondary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const KEY_SIZE = 72;

function Key({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: KEY_SIZE,
        height: KEY_SIZE,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <T variant="title" style={{ fontWeight: '600' }}>
        {label}
      </T>
    </Pressable>
  );
}
