import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect, SheetHeader } from '../../../src/components/forms';
import { Button, T } from '../../../src/components/ui';
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
  const [dueDay, setDueDay] = useState(String(category?.dueDay ?? 1));

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

    const parsedDueDay = Math.min(31, Math.max(1, Number.parseInt(dueDay, 10) || 1));

    state.updateCategory(category!.id, {
      name: trimmed,
      cardId,
      icon,
      dueDay: parsedDueDay,
    });
    router.back();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <SheetHeader title="Edit category" onClose={() => router.back()} />

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

      <Field
        label="Due day (1–31)"
        value={dueDay}
        onChangeText={setDueDay}
        placeholder="1"
        keyboardType="numeric"
      />

      <Button label="Save changes" onPress={handleSave} disabled={!name.trim()} />
    </ScrollView>
  );
}
