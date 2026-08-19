import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { DayPicker } from '~/features/budget/components/DayPicker';
import { IconPicker, NameWithIconField } from '~/shared/components/forms';
import { DEFAULT_CATEGORY_ICON, suggestCategoryIcon } from '~/shared/data/categoryIcons';
import { BottomSheet, Button, GradientButton, Label, Row, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
import { FREQUENCY_LABEL } from '../../../src/db/schema';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

export default function EditCategoryScreen() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const router = useRouter();
  const category = useMemo(() => state.categories.find((c) => c.id === id), [state.categories, id]);

  // The bills inside this category. Frequency lives on the bill, not the
  // category, so this list is the route to it — without it a single-line
  // category (e.g. a one-off "Down Payment") had no reachable frequency at all.
  const bills = useMemo(
    () => state.subcategories.filter((s) => s.categoryId === id),
    [state.subcategories, id],
  );

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
        <Text variant="heading">Category not found</Text>
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
      asRoute
      onClose={closeModal}
      title="Edit category"
      icon={icon}
      iconColor={category.color}
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
          <NameWithIconField
            value={name}
            onChangeText={onNameChange}
            icon={icon}
            iconColor={category.color}
            placeholder="Category name"
          />

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

          {/* The bills in this category, each showing how often it recurs.
              Tapping one opens its editor, which is where frequency (monthly,
              one-time, yearly) is actually set — a per-bill property, so it
              cannot live on the category itself. */}
          {bills.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>BILLS IN THIS CATEGORY</Label>
              <View style={{ gap: 6 }}>
                {bills.map((bill) => (
                  <Pressable
                    key={bill.id}
                    onPress={() => router.push(`/subcategory/${bill.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${bill.name}, ${FREQUENCY_LABEL[bill.frequency]}. Edit.`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingVertical: 11,
                      paddingHorizontal: space.md,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                      backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
                    })}
                  >
                    <Ionicons
                      name={(bill.icon ?? 'pricetag-outline') as keyof typeof Ionicons.glyphMap}
                      size={17}
                      color={colors.inkMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                        {bill.name}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {FREQUENCY_LABEL[bill.frequency]} · {formatMoney(bill.plannedMinor)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
                  </Pressable>
                ))}
              </View>
              <Text variant="caption" tone="muted">
                Tap a bill to change how often it repeats — use One-time for a cost you paid once,
                so it stops counting in later months.
              </Text>
            </View>
          ) : null}
    </BottomSheet>
  );
}
