import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ALL_ICONS, CATEGORY_ICONS } from '../data/categoryIcons';
import {
  CATEGORY_DEFAULT_FREQUENCIES,
  FREQUENCY_SHORT_LABEL,
  FREQUENCY_HINT,
  FREQUENCY_LABEL,
  SUBCATEGORY_FREQUENCIES,
  type SubcategoryFrequency,
} from '../db/schema';
import { formatAmountInput } from '../core/money';
import { useTheme } from '../theme/ThemeProvider';
import { BottomSheet, Label, Text } from './ui';

/** The single styled input used by every form. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  money = false,
  autoFocus,
  multiline,
  style,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  /**
   * Treat this as a money field: reshape every keystroke through
   * `formatAmountInput`, so thousands separators appear as the figure grows and
   * nothing but a valid partial number can be typed.
   *
   * Opt-in rather than inferred from `keyboardType`, because plenty of numeric
   * fields are NOT money — an odometer reading, a litre count, a percentage
   * rate, a term in months — and grouping those would be wrong. The caller
   * knows which it is; the keyboard does not.
   *
   * Implies `decimal-pad`: the numeric pad offers punctuation this field would
   * only strip again.
   *
   * The caller therefore always holds a display-formatted string, and
   * `parseAmount` strips the separators again on save. It already tolerates
   * them, so callers need no other change.
   */
  money?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Why the current value cannot be used, shown under the field.
   *
   * The caller decides WHEN to pass this — usually not while the field is still
   * being typed into, since flagging "Enter an amount" against a half-typed
   * value is nagging rather than helping.
   */
  error?: string | null;
}) {
  const { colors, radius, space } = useTheme();
  const handleChange = money ? (next: string) => onChangeText(formatAmountInput(next)) : onChangeText;

  return (
    <View style={[{ gap: space.sm }, style]}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        keyboardType={money ? 'decimal-pad' : keyboardType}
        autoFocus={autoFocus}
        multiline={multiline}
        accessibilityLabel={label}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          // The border carries the error too, so the field itself is marked
          // rather than only the sentence beneath it.
          borderColor: error ? colors.danger : colors.hairline,
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
      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The category identity field: the chosen icon as a leading tile INSIDE the
 * input box, then the name. One aligned control (tile height = input height) so
 * create- and edit-category read identically, and the live-suggested icon sits
 * right where you type. The tile is tappable to jump to the icon picker.
 */
export function NameWithIconField({
  label = 'Name',
  value,
  onChangeText,
  icon,
  iconColor,
  placeholder,
  autoFocus,
  onPressIcon,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Optional: tap the leading tile (e.g. to open the icon picker). */
  onPressIcon?: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const Tile = onPressIcon ? Pressable : View;
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairline,
          paddingLeft: space.md,
          paddingRight: space.md,
        }}
      >
        {/* Plain suggested-icon glyph (no tinted tile), with a hairline divider
            separating it from the text so it reads as a leading affordance. */}
        <Tile
          {...(onPressIcon ? { onPress: onPressIcon, accessibilityRole: 'button' as const, accessibilityLabel: 'Change icon', hitSlop: 8 } : {})}
          style={{ alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={icon} size={22} color={iconColor} />
        </Tile>
        <View
          style={{
            width: StyleSheet.hairlineWidth,
            alignSelf: 'stretch',
            marginVertical: 10,
            marginLeft: space.md,
            backgroundColor: colors.hairline,
          }}
        />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          autoFocus={autoFocus}
          accessibilityLabel={label}
          style={{
            flex: 1,
            paddingLeft: space.md,
            paddingVertical: 14,
            fontSize: 16,
            fontWeight: '400',
            letterSpacing: 0,
            color: colors.ink,
          }}
        />
      </View>
    </View>
  );
}

export interface SelectOption {
  key: string;
  label: string;
  /**
   * What a screen reader says, when the visible label is an abbreviation.
   *
   * A pill in a one-row selector is shortened to fit ("Budget" for "Spending
   * budget"), and abbreviating for space is a visual compromise that should not
   * reach someone who cannot see the layout it was made for. Defaults to
   * `label`.
   */
  spokenLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
}

/** Wrapping pill selector. Selection shows as fill + weight, not colour alone. */
export function PillSelect({
  label,
  options,
  selectedKey,
  onSelect,
  singleRow = false,
}: {
  label?: string;
  options: readonly SelectOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /**
   * Keep every option on ONE line, sharing the width equally.
   *
   * Opt-in rather than the default because it only suits short, comparable
   * labels. A wrapped set of pills reads as a loose bag of choices, which is
   * right for something like an icon picker but wrong for a small fixed set
   * that is really one decision — those read better as a single segmented row,
   * where the options line up and can be compared at a glance.
   *
   * Labels are allowed to shrink and truncate rather than pushing the row wider
   * than its container, since the hint line underneath carries the full meaning.
   */
  singleRow?: boolean;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      {label ? <Label>{label}</Label> : null}
      <View
        style={{
          flexDirection: 'row',
          gap: singleRow ? 6 : space.sm,
          flexWrap: singleRow ? 'nowrap' : 'wrap',
        }}
      >
        {options.map((option) => {
          const selected = selectedKey === option.key;
          const accent = option.color ?? colors.accent;
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.spokenLabel ?? option.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: singleRow ? 'center' : undefined,
                gap: 6,
                paddingVertical: 9,
                // Equal shares of the row, and `minWidth: 0` so a long label
                // truncates inside its pill instead of forcing an overflow.
                ...(singleRow
                  ? { flex: 1, minWidth: 0, paddingHorizontal: space.sm }
                  : { paddingHorizontal: space.md }),
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
              <Text
                variant="small"
                color={selected ? colors.inkInverse : colors.inkSecondary}
                style={{ fontWeight: selected ? '700' : '500' }}
                // One line only in row mode, shrinking to fit before it clips —
                // "Spending budget" beside three shorter labels would otherwise
                // either wrap the pill to two lines or push the row too wide.
                numberOfLines={singleRow ? 1 : undefined}
                adjustsFontSizeToFit={singleRow || undefined}
                minimumFontScale={singleRow ? 0.85 : undefined}
              >
                {option.label}
              </Text>
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
  error,
}: {
  value: string;
  onChangeText: (text: string) => void;
  currency: string;
  label?: string;
  hero?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** Why the amount cannot be saved. See `validateAmount` in core/money. */
  error?: string | null;
}) {
  const { colors, radius, space } = useTheme();

  /*
   * Every keystroke is reshaped before it reaches the caller, so thousands
   * separators appear as the number grows and nothing but a valid partial
   * number can be typed. Done HERE rather than in each screen so every money
   * field in the app behaves identically — there are several, and they had
   * drifted into accepting whatever the keyboard emitted.
   *
   * The caller therefore always holds a display-formatted string; `parseAmount`
   * strips the separators again on save.
   */
  const handleChange = (next: string) => onChangeText(formatAmountInput(next));

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
            borderColor: error ? colors.danger : colors.hairline,
            paddingHorizontal: space.md,
          }}
        >
          <Text variant="small" tone="muted">
            {currency}
          </Text>
          <TextInput
            value={value}
            onChangeText={handleChange}
            keyboardType="decimal-pad"
            autoFocus={autoFocus}
            placeholder={placeholder}
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel={label ?? 'Amount'}
            style={{ flex: 1, paddingVertical: 13, fontSize: 16, fontWeight: '400', color: colors.ink, letterSpacing: 0 }}
          />
        </View>
        {error ? (
          <Text variant="caption" color={colors.danger}>
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      {label ? <Label>{label}</Label> : null}
      {/* `sm` rather than `xs`: the gap sits against 42px digits here, and the
          4px that reads as a space beside body text reads as the code touching
          the number at this size. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="title" tone="muted">
          {currency}
        </Text>
        <TextInput
          value={value}
          onChangeText={handleChange}
          // `decimal-pad` rather than `numeric`: the numeric pad on iOS offers
          // punctuation this field would only strip again, and no minus sign is
          // wanted on an amount.
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel={label ?? 'Amount'}
          style={{
            fontSize: 42,
            fontWeight: '800',
            letterSpacing: -1.2,
            color: error ? colors.danger : colors.ink,
            minWidth: 110,
            textAlign: 'center',
            padding: 0,
          }}
        />
      </View>
      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}
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
              placeholderTextColor={colors.inkMuted}
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
              <Text variant="small" tone="muted">
                No icons match “{query}”.
              </Text>
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
    // Short labels: these sit four-across on one row, and the hint line below
    // carries the full meaning of whichever is selected. The full wording is
    // kept for screen readers, which have no such constraint.
    (key) => ({ key, label: FREQUENCY_SHORT_LABEL[key], spokenLabel: FREQUENCY_LABEL[key] }),
  );
  return (
    <View style={{ gap: 6 }}>
      <PillSelect
        label={label}
        options={options}
        selectedKey={value}
        onSelect={(key) => onChange(key as SubcategoryFrequency)}
        // One row: these are four alternatives to one question, and wrapping
        // them onto two lines made the set read as two groups.
        singleRow
      />
      {/* One line saying what the chosen cadence actually does. "Spending
          budget" especially needs it: it behaves unlike the other three (many
          entries summed, never ticked off as a whole) and a two-word pill
          cannot carry that. */}
      <Text variant="caption" tone="muted">
        {FREQUENCY_HINT[value]}
      </Text>
    </View>
  );
}

