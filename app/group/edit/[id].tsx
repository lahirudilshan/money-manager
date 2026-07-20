import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ColorPicker, Field, PillSelect, SheetHeader } from '../../../src/components/forms';
import { Button, T } from '../../../src/components/ui';
import { useAppStore } from '../../../src/store/useAppStore';
import { groupColors } from '../../../src/theme';
import { useTheme } from '../../../src/theme/ThemeProvider';

const GROUP_ICONS = [
  { key: 'home-outline', label: 'Home', icon: 'home-outline' as const },
  { key: 'basket-outline', label: 'Living', icon: 'basket-outline' as const },
  { key: 'card-outline', label: 'Loans', icon: 'card-outline' as const },
  { key: 'car-sport-outline', label: 'Vehicle', icon: 'car-sport-outline' as const },
  { key: 'repeat-outline', label: 'Subs', icon: 'repeat-outline' as const },
  { key: 'albums-outline', label: 'Other', icon: 'albums-outline' as const },
];

export default function EditGroupScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const group = useMemo(() => state.groups.find((g) => g.id === id), [state.groups, id]);

  const [name, setName] = useState(group?.name ?? '');
  const [icon, setIcon] = useState(group?.icon ?? GROUP_ICONS[0].key);
  const [cardId, setCardId] = useState<string | null>(group?.cardId ?? null);
  const [colorIndex, setColorIndex] = useState(() => {
    const found = groupColors.indexOf((group?.color ?? '') as (typeof groupColors)[number]);
    return found >= 0 ? found : 0;
  });

  if (!group) {
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
        <T variant="heading">Group not found</T>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.updateGroup(group!.id, {
      name: trimmed,
      cardId,
      color: groupColors[colorIndex],
      icon,
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
      <SheetHeader title="Edit group" onClose={() => router.back()} />

      <Field label="Name" value={name} onChangeText={setName} placeholder="Group name" />

      <PillSelect label="Icon" options={GROUP_ICONS} selectedKey={icon} onSelect={setIcon} />

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

      <ColorPicker colors={groupColors} selectedIndex={colorIndex} onSelect={setColorIndex} />

      <Button label="Save changes" onPress={handleSave} disabled={!name.trim()} />
    </ScrollView>
  );
}
