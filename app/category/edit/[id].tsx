import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { AccountField } from '../../../src/components/AccountPicker';
import { DayPicker } from '../../../src/components/DayPicker';
import { Field, ModalScreen, PillSelect } from '../../../src/components/forms';
import { Button, GradientButton, Label, PinnedFooter, T } from '../../../src/components/ui';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * A broad, recognisable icon set for categories, each with the keywords that
 * should auto-suggest it from a typed name. First matching entry wins, so more
 * specific words are listed earlier.
 */
const CATEGORY_ICONS: { icon: keyof typeof Ionicons.glyphMap; label: string; keywords: string[] }[] = [
  { icon: 'home-outline', label: 'Home', keywords: ['home', 'house', 'rent', 'housing', 'mortgage'] },
  { icon: 'flash-outline', label: 'Utilities', keywords: ['electric', 'utility', 'utilities', 'power', 'ceb'] },
  { icon: 'water-outline', label: 'Water', keywords: ['water', 'nwsdb'] },
  { icon: 'basket-outline', label: 'Groceries', keywords: ['grocery', 'groceries', 'food', 'market', 'keells'] },
  { icon: 'restaurant-outline', label: 'Dining', keywords: ['dining', 'eat', 'restaurant', 'lunch', 'dinner'] },
  { icon: 'car-sport-outline', label: 'Vehicle', keywords: ['car', 'vehicle', 'fuel', 'petrol', 'transport'] },
  { icon: 'card-outline', label: 'Loans', keywords: ['loan', 'debt', 'lease', 'installment', 'credit'] },
  { icon: 'medkit-outline', label: 'Health', keywords: ['health', 'medical', 'doctor', 'pharmacy', 'insurance'] },
  { icon: 'school-outline', label: 'Education', keywords: ['education', 'school', 'tuition', 'class', 'course'] },
  { icon: 'repeat-outline', label: 'Subscriptions', keywords: ['sub', 'subscription', 'netflix', 'spotify', 'streaming'] },
  { icon: 'call-outline', label: 'Phone', keywords: ['phone', 'mobile', 'internet', 'dialog', 'telecom', 'wifi'] },
  { icon: 'airplane-outline', label: 'Travel', keywords: ['travel', 'trip', 'flight', 'holiday', 'vacation'] },
  { icon: 'gift-outline', label: 'Gifts', keywords: ['gift', 'present', 'donation', 'charity'] },
  { icon: 'paw-outline', label: 'Pets', keywords: ['pet', 'dog', 'cat', 'vet'] },
  { icon: 'shirt-outline', label: 'Shopping', keywords: ['shopping', 'clothes', 'shirt', 'apparel'] },
  { icon: 'albums-outline', label: 'Other', keywords: [] },
];

/** Suggest an icon from the category name; null when nothing matches. */
function suggestIcon(name: string): keyof typeof Ionicons.glyphMap | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  for (const entry of CATEGORY_ICONS) {
    if (entry.keywords.some((k) => n.includes(k))) return entry.icon;
  }
  return null;
}

// A category's *default* cadence for new bills — unplanned is a per-bill choice
// made on the subcategory itself, so it isn't offered as a category default.
const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'one_time', label: 'One-time' },
] as const;

type Frequency = 'monthly' | 'one_time' | 'yearly';

export default function EditCategoryScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const category = useMemo(() => state.categories.find((c) => c.id === id), [state.categories, id]);

  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState<keyof typeof Ionicons.glyphMap>(
    (category?.icon as keyof typeof Ionicons.glyphMap) ?? 'albums-outline',
  );
  // Once the user picks an icon by hand, stop auto-suggesting over their choice.
  const [iconTouched, setIconTouched] = useState(false);
  const [cardId, setCardId] = useState<string | null>(category?.cardId ?? null);
  const [dueDay, setDueDay] = useState(category?.dueDay ?? 1);
  const [frequency, setFrequency] = useState<Frequency>(category?.defaultFrequency ?? 'monthly');

  function onNameChange(next: string) {
    setName(next);
    if (!iconTouched) {
      const suggested = suggestIcon(next);
      if (suggested) setIcon(suggested);
    }
  }

  const isDirty =
    name.trim() !== (category?.name ?? '') ||
    icon !== (category?.icon ?? 'albums-outline') ||
    cardId !== (category?.cardId ?? null) ||
    dueDay !== (category?.dueDay ?? 1) ||
    frequency !== (category?.defaultFrequency ?? 'monthly');

  if (!category) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <T variant="heading">Category not found</T>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    state.updateCategory(category!.id, {
      name: trimmed,
      cardId,
      icon,
      dueDay: Math.min(31, Math.max(1, dueDay)),
      defaultFrequency: frequency,
    });
    router.back();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ModalScreen title="Edit category" onClose={() => router.back()}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: space.xl,
            paddingHorizontal: space.lg,
            gap: space.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Name + a live preview of the chosen icon, so the identity reads at
              a glance and the auto-suggested icon is visible as you type. */}
          <View style={{ gap: space.sm }}>
            <Label>Name</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${category.color}1F`,
                }}
              >
                <Ionicons name={icon} size={24} color={category.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="" value={name} onChangeText={onNameChange} placeholder="Category name" />
              </View>
            </View>
          </View>

          {/* Icon grid — tap to override the suggestion. */}
          <View style={{ gap: space.sm }}>
            <Label>Icon</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {CATEGORY_ICONS.map((entry) => {
                const selected = entry.icon === icon;
                return (
                  <Pressable
                    key={entry.icon}
                    onPress={() => {
                      setIcon(entry.icon);
                      setIconTouched(true);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={entry.label}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1.5,
                      borderColor: selected ? category.color : colors.hairline,
                      backgroundColor: selected ? `${category.color}1F` : colors.surface,
                    }}
                  >
                    <Ionicons name={entry.icon} size={22} color={selected ? category.color : colors.inkSecondary} />
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Shared account picker — identical to everywhere else. */}
          <AccountField
            label="Funded account"
            cards={state.cards}
            selectedId={cardId}
            onSelect={setCardId}
            allowNone
          />

          <PillSelect
            label="Default frequency for new bills"
            options={FREQUENCIES.map((f) => ({ key: f.key, label: f.label }))}
            selectedKey={frequency}
            onSelect={(key) => setFrequency(key as Frequency)}
          />

          <DayPicker value={dueDay} onChange={setDueDay} />
        </ScrollView>

        <PinnedFooter followsKeyboard>
          <GradientButton
            label="Save changes"
            icon="checkmark"
            onPress={handleSave}
            disabled={!name.trim() || !isDirty}
          />
        </PinnedFooter>
      </ModalScreen>
    </KeyboardAvoidingView>
  );
}
