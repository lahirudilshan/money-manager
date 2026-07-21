import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Label, T } from './ui';

/** The single styled input used by every form. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoFocus,
  multiline,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  autoFocus?: boolean;
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View style={[{ gap: space.sm }, style]}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        multiline={multiline}
        accessibilityLabel={label}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairline,
          paddingHorizontal: space.md,
          paddingVertical: 13,
          fontSize: 16,
          fontWeight: '500' as const,
          color: colors.ink,
          minHeight: multiline ? 88 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export interface SelectOption {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
}

/** Wrapping pill selector. Selection shows as fill + weight, not colour alone. */
export function PillSelect({
  label,
  options,
  selectedKey,
  onSelect,
}: {
  label?: string;
  options: readonly SelectOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      {label ? <Label>{label}</Label> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {options.map((option) => {
          const selected = selectedKey === option.key;
          const accent = option.color ?? colors.accent;
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 9,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: selected ? accent : colors.surface,
                borderWidth: 1,
                borderColor: selected ? accent : colors.hairline,
              }}
            >
              {option.icon ? (
                <Ionicons
                  name={option.icon}
                  size={14}
                  color={selected ? colors.inkInverse : colors.inkSecondary}
                />
              ) : null}
              <T
                variant="small"
                color={selected ? colors.inkInverse : colors.inkSecondary}
                style={{ fontWeight: selected ? '700' : '500' }}
              >
                {option.label}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ColorPicker({
  label = 'Colour',
  colors: swatches,
  selectedIndex,
  onSelect,
}: {
  label?: string;
  colors: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const { colors, space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {swatches.map((swatch, index) => (
          <Pressable
            key={swatch}
            onPress={() => onSelect(index)}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedIndex === index }}
            accessibilityLabel={`Colour ${index + 1}`}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: swatch,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: selectedIndex === index ? 3 : 0,
              borderColor: colors.ink,
            }}
          >
            {selectedIndex === index ? (
              <Ionicons name="checkmark" size={17} color="#FFFFFF" />
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <T variant="title">{title}</T>
      <Pressable
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={25} color={colors.inkSecondary} />
      </Pressable>
    </View>
  );
}
