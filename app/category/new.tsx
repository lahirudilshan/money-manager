import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DayPicker } from '../../src/components/DayPicker';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { GradientButton, PinnedFooter, T } from '../../src/components/ui';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const CATEGORY_ICONS = [
  { key: 'home-outline', label: 'Home', icon: 'home-outline' as const },
  { key: 'basket-outline', label: 'Living', icon: 'basket-outline' as const },
  { key: 'card-outline', label: 'Loans', icon: 'card-outline' as const },
  { key: 'car-sport-outline', label: 'Vehicle', icon: 'car-sport-outline' as const },
  { key: 'repeat-outline', label: 'Subs', icon: 'repeat-outline' as const },
  { key: 'albums-outline', label: 'Other', icon: 'albums-outline' as const },
];

const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'one_time', label: 'One-time' },
] as const;

type Frequency = 'monthly' | 'one_time' | 'yearly';

export default function NewCategoryScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const [name, setName] = useState('');
  const [icon, setIcon] = useState(CATEGORY_ICONS[0].key);
  const [cardId, setCardId] = useState<string | null>(state.cards[0]?.id ?? null);
  const [dueDay, setDueDay] = useState(1);
  const [frequency, setFrequency] = useState<Frequency>('monthly');

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.addCategory({
      name: trimmed,
      cardId,
      icon,
      dueDay,
      defaultFrequency: frequency,
      sortOrder: state.categories.length,
    });
    router.back();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        <SheetHeader title="New category" onClose={() => router.back()} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: space.xl,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Home Expenses"
          autoFocus
        />

        <PillSelect label="Icon" options={CATEGORY_ICONS} selectedKey={icon} onSelect={setIcon} />

        {state.cards.length > 0 ? (
          <PillSelect
            label="Transfer money to"
            options={state.cards.map((card) => ({ key: card.id, label: card.name }))}
            selectedKey={cardId}
            onSelect={setCardId}
          />
        ) : (
          <T variant="small" tone="muted">
            Add an account first to choose where this category's money goes.
          </T>
        )}

        <PillSelect
          label="Default frequency for new bills"
          options={FREQUENCIES.map((f) => ({ key: f.key, label: f.label }))}
          selectedKey={frequency}
          onSelect={(key) => setFrequency(key as Frequency)}
        />

        <DayPicker value={dueDay} onChange={setDueDay} />
      </ScrollView>

      <PinnedFooter>
        <GradientButton
          label="Create category"
          icon="checkmark"
          onPress={handleCreate}
          disabled={!name.trim()}
        />
      </PinnedFooter>
    </KeyboardAvoidingView>
  );
}
