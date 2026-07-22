import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DayPicker } from '../../../src/components/DayPicker';
import { Field, PillSelect, SheetHeader } from '../../../src/components/forms';
import { Button, GradientButton, PinnedFooter, T } from '../../../src/components/ui';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

const CATEGORY_ICONS = [
  { key: 'home-outline', label: 'Home', icon: 'home-outline' as const },
  { key: 'basket-outline', label: 'Living', icon: 'basket-outline' as const },
  { key: 'card-outline', label: 'Loans', icon: 'card-outline' as const },
  { key: 'car-sport-outline', label: 'Vehicle', icon: 'car-sport-outline' as const },
  { key: 'repeat-outline', label: 'Subs', icon: 'repeat-outline' as const },
  { key: 'albums-outline', label: 'Other', icon: 'albums-outline' as const },
];

export default function EditCategoryScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const category = useMemo(() => state.categories.find((c) => c.id === id), [state.categories, id]);

  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICONS[0].key);
  const [cardId, setCardId] = useState<string | null>(category?.cardId ?? null);
  const [dueDay, setDueDay] = useState(category?.dueDay ?? 1);

  if (!category) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.md,
        }}
      >
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
    });
    router.back();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        <SheetHeader title="Edit category" onClose={() => router.back()} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.lg,
          paddingBottom: space.xl,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field label="Name" value={name} onChangeText={setName} placeholder="Category name" />

        <PillSelect label="Icon" options={CATEGORY_ICONS} selectedKey={icon} onSelect={setIcon} />

        <PillSelect
          label="Transfer money to"
          options={state.cards.map((card) => ({
            key: card.id,
            label: card.name,
          }))}
          selectedKey={cardId}
          onSelect={setCardId}
        />

        <DayPicker value={dueDay} onChange={setDueDay} />
      </ScrollView>

      <PinnedFooter>
        <GradientButton label="Save changes" icon="checkmark" onPress={handleSave} disabled={!name.trim()} />
      </PinnedFooter>
    </KeyboardAvoidingView>
  );
}
