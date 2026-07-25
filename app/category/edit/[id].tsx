import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AccountField } from '../../../src/components/AccountPicker';
import { DayPicker } from '../../../src/components/DayPicker';
import { Field, IconPicker } from '../../../src/components/forms';
import { DEFAULT_CATEGORY_ICON, suggestCategoryIcon } from '../../../src/data/categoryIcons';
import { BottomSheet, Button, GradientButton, Label, T } from '../../../src/components/ui';
import { useModalClose } from '../../../src/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

export default function EditCategoryScreen() {
  const { colors, radius, space } = useTheme();
  const closeModal = useModalClose();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const category = useMemo(() => state.categories.find((c) => c.id === id), [state.categories, id]);

  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState<keyof typeof Ionicons.glyphMap>(
    (category?.icon as keyof typeof Ionicons.glyphMap) ?? DEFAULT_CATEGORY_ICON,
  );
  // Once the user picks an icon by hand, stop auto-suggesting over their choice.
  const [iconTouched, setIconTouched] = useState(false);
  const [cardId, setCardId] = useState<string | null>(category?.cardId ?? null);
  const [dueDay, setDueDay] = useState(category?.dueDay ?? 1);

  function onNameChange(next: string) {
    setName(next);
    if (!iconTouched) {
      const suggested = suggestCategoryIcon(next);
      if (suggested) setIcon(suggested);
    }
  }

  const isDirty =
    name.trim() !== (category?.name ?? '') ||
    icon !== (category?.icon ?? DEFAULT_CATEGORY_ICON) ||
    cardId !== (category?.cardId ?? null) ||
    dueDay !== (category?.dueDay ?? 1);

  if (!category) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <T variant="heading">Category not found</T>
        <Button label="Go back" onPress={closeModal} variant="ghost" />
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
    closeModal();
  }

  return (
    <BottomSheet
      visible
      onClose={closeModal}
      title="Edit category"
      icon={icon}
      iconColor={category.color}
      heightPct={0.9}
      scroll
      footer={
        <GradientButton
          label="Save changes"
          icon="checkmark"
          onPress={handleSave}
          disabled={!name.trim() || !isDirty}
        />
      }
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

          {/* Icon grid — tap to override the auto-suggestion. */}
          <IconPicker
            value={icon}
            onChange={(next) => {
              setIcon(next);
              setIconTouched(true);
            }}
            accent={category.color}
          />

          {/* Shared account picker — identical to everywhere else. */}
          <AccountField
            label="Funded account"
            cards={state.cards}
            selectedId={cardId}
            onSelect={setCardId}
            allowNone
          />

          <DayPicker value={dueDay} onChange={setDueDay} />
    </BottomSheet>
  );
}
