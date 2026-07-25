import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ALL_ICONS, CATEGORY_ICONS } from '../data/categoryIcons';
import {
  CATEGORY_DEFAULT_FREQUENCIES,
  FREQUENCY_LABEL,
  SUBCATEGORY_FREQUENCIES,
  type SubcategoryFrequency,
} from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { BottomSheet, Label, T } from './ui';

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
        placeholderTextColor={colors.inkFaint}
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
          fontWeight: '400' as const,
          // Explicit zero so placeholder + typed text read as plain body text,
          // never picking up a wide tracking from a parent/label style.
          letterSpacing: 0,
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

/**
 * A currency amount input. Two looks from one component:
 *  - `hero` (default): a large, centered figure with the currency as a muted
 *    prefix — the headline "how much" on add/log screens.
 *  - non-hero: a bordered field like any other, for a secondary amount.
 * Replaces the four separately-tuned big-number inputs across the app so the
 * headline amount looks identical everywhere.
 */
export function AmountField({
  value,
  onChangeText,
  currency,
  label,
  hero = true,
  autoFocus,
  placeholder = '0',
}: {
  value: string;
  onChangeText: (text: string) => void;
  currency: string;
  label?: string;
  hero?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { colors, radius, space } = useTheme();

  if (!hero) {
    return (
      <View style={{ gap: space.sm }}>
        {label ? <Label>{label}</Label> : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.hairline,
            paddingHorizontal: space.md,
          }}
        >
          <T variant="small" tone="muted">
            {currency}
          </T>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            keyboardType="numeric"
            autoFocus={autoFocus}
            placeholder={placeholder}
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel={label ?? 'Amount'}
            style={{ flex: 1, paddingVertical: 13, fontSize: 16, fontWeight: '400', color: colors.ink, letterSpacing: 0 }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      {label ? <Label>{label}</Label> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <T variant="title" tone="muted">
          {currency}
        </T>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel={label ?? 'Amount'}
          style={{
            fontSize: 42,
            fontWeight: '800',
            letterSpacing: -1.2,
            color: colors.ink,
            minWidth: 110,
            textAlign: 'center',
            padding: 0,
          }}
        />
      </View>
    </View>
  );
}

/** A single tappable icon tile — shared by the inline row and the picker sheet. */
function IconTile({
  icon,
  selected,
  accent,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  accent: string;
  onPress: () => void;
  label?: string;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        width: 52,
        height: 52,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: selected ? accent : colors.hairline,
        backgroundColor: selected ? `${accent}1F` : colors.surface,
      }}
    >
      <Ionicons name={icon} size={22} color={selected ? accent : colors.inkSecondary} />
    </Pressable>
  );
}

/**
 * The one category icon picker. Shows a SINGLE row: the currently-selected icon
 * first (so a name-suggested icon leads), then the common quick-pick icons, then
 * a "more" tile that opens a searchable sheet over the full catalog. Keeps the
 * form compact while still giving access to every icon. Used by create- and
 * edit-category so they always offer the same icons.
 */
export function IconPicker({
  label = 'Icon',
  value,
  onChange,
  accent,
}: {
  label?: string;
  value: keyof typeof Ionicons.glyphMap;
  onChange: (icon: keyof typeof Ionicons.glyphMap) => void;
  accent: string;
}) {
  const { colors, radius, space } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState('');

  // The inline row: selected icon first, then the quick-pick set, de-duped, so
  // the chosen icon (which may be from the full catalog) is always visible.
  const quick = CATEGORY_ICONS.map((e) => e.icon);
  const row = [value, ...quick.filter((i) => i !== value)].slice(0, 5);

  const results = ALL_ICONS.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return e.label.toLowerCase().includes(q) || e.icon.toLowerCase().includes(q);
  });

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {row.map((icon) => (
          <IconTile
            key={icon}
            icon={icon}
            selected={icon === value}
            accent={accent}
            onPress={() => onChange(icon)}
          />
        ))}
        {/* "More" tile — opens the searchable catalog. */}
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="More icons"
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: colors.hairlineStrong,
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.inkSecondary} />
        </Pressable>
      </View>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setQuery('');
        }}
        title="Choose an icon"
      >
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: colors.surfaceSunken,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
            }}
          >
            <Ionicons name="search" size={16} color={colors.inkMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search icons…"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Search icons"
              style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
            />
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {results.map((entry) => (
              <IconTile
                key={entry.icon}
                icon={entry.icon}
                selected={entry.icon === value}
                accent={accent}
                label={entry.label}
                onPress={() => {
                  onChange(entry.icon);
                  setSheetOpen(false);
                  setQuery('');
                }}
              />
            ))}
            {results.length === 0 ? (
              <T variant="small" tone="muted">
                No icons match “{query}”.
              </T>
            ) : null}
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

/**
 * The one frequency selector used everywhere a subcategory/bill cadence is
 * chosen. Draws its options and labels from the schema's canonical source
 * (FREQUENCY_LABEL / CATEGORY_DEFAULT_FREQUENCIES) so ordering and wording can
 * never drift between screens. `includeUnplanned` adds the unplanned option for
 * per-bill pickers; leave it off for a category's *default* cadence.
 */
export function FrequencyPicker({
  label = 'Frequency',
  value,
  onChange,
  includeUnplanned = false,
}: {
  label?: string;
  value: SubcategoryFrequency;
  onChange: (value: SubcategoryFrequency) => void;
  includeUnplanned?: boolean;
}) {
  const options = (includeUnplanned ? SUBCATEGORY_FREQUENCIES : CATEGORY_DEFAULT_FREQUENCIES).map(
    (key) => ({ key, label: FREQUENCY_LABEL[key] }),
  );
  return (
    <PillSelect
      label={label}
      options={options}
      selectedKey={value}
      onSelect={(key) => onChange(key as SubcategoryFrequency)}
    />
  );
}
