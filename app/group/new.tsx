import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ColorPicker, Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { Button, T } from '../../src/components/ui';
import { useAppStore } from '../../src/store/useAppStore';
import { groupColors } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

const GROUP_ICONS = [
  { key: 'home-outline', label: 'Home', icon: 'home-outline' as const },
  { key: 'basket-outline', label: 'Living', icon: 'basket-outline' as const },
  { key: 'card-outline', label: 'Loans', icon: 'card-outline' as const },
  { key: 'car-sport-outline', label: 'Vehicle', icon: 'car-sport-outline' as const },
  { key: 'repeat-outline', label: 'Subs', icon: 'repeat-outline' as const },
  { key: 'albums-outline', label: 'Other', icon: 'albums-outline' as const },
];

export default function NewGroupScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const [name, setName] = useState('');
  const [icon, setIcon] = useState(GROUP_ICONS[0].key);
  const [cardId, setCardId] = useState<string | null>(state.cards[0]?.id ?? null);
  const [colorIndex, setColorIndex] = useState(state.groups.length % groupColors.length);

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.addGroup({
      name: trimmed,
      cardId,
      color: groupColors[colorIndex],
      icon,
      dueDay: 1,
      sortOrder: state.groups.length,
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
      <SheetHeader title="New group" onClose={() => router.back()} />

      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Home Expenses"
        autoFocus
      />

      <PillSelect
        label="Icon"
        options={GROUP_ICONS}
        selectedKey={icon}
        onSelect={setIcon}
      />

      {state.cards.length > 0 ? (
        <>
          <PillSelect
            label="Transfer money to"
            options={state.cards.map((card) => ({
              key: card.id,
              label: card.name,
              color: card.color,
            }))}
            selectedKey={cardId}
            onSelect={setCardId}
          />
          <T variant="caption" tone="muted">
            This group's total gets transferred to that card each month.
          </T>
        </>
      ) : (
        <T variant="small" tone="muted">
          Add a card first to choose where this group's money goes.
        </T>
      )}

      <ColorPicker
        colors={groupColors}
        selectedIndex={colorIndex}
        onSelect={setColorIndex}
      />

      <Button label="Create group" onPress={handleCreate} disabled={!name.trim()} />
    </ScrollView>
  );
}
