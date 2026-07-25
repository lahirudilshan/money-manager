import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Field } from '../../src/components/forms';
import { BottomSheet, GradientButton, Label, T } from '../../src/components/ui';
import { DayPicker } from '../../src/components/DayPicker';
import { useModalClose } from '../../src/hooks/useModalClose';
import { parseAmount } from '../../src/core/money';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Add one entry to an unplanned subcategory (e.g. a single grocery run under
 * "Groceries"). Unplanned lines have no fixed amount — they accumulate many of
 * these, and the line's spend is their sum — so this is deliberately minimal:
 * what, how much, and when. Opened from the subcategory screen's "Add" action.
 */
export default function AddUnplannedTransaction() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const { subcategoryId } = useLocalSearchParams<{ subcategoryId: string }>();
  const state = useAppStore();

  const subcategory = useMemo(
    () => state.subcategories.find((s) => s.id === subcategoryId),
    [state.subcategories, subcategoryId],
  );

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(new Date().getDate());

  const amountMinor = parseAmount(amount) ?? 0;
  const canSave = Boolean(subcategoryId) && name.trim().length > 0 && amountMinor > 0;

  function handleSave() {
    if (!canSave || !subcategoryId) return;
    // Anchor the entry to the month the user is *viewing* (not necessarily the
    // current calendar month), on the chosen day, so it shows up in the list
    // they're looking at. The store derives the period from this date.
    const [year, month] = state.period.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    state.addTransaction({ subcategoryId, name: name.trim(), amountMinor, date });
    closeModal();
  }

  return (
    <BottomSheet
      visible
      onClose={closeModal}
      title="Add entry"
      eyebrow={subcategory ? `Entry in ${subcategory.name}` : undefined}
      icon="add-circle-outline"
      iconColor={colors.accent}
      heightPct={0.85}
      scroll
      footer={<GradientButton label="Add entry" icon="add" onPress={handleSave} disabled={!canSave} />}
    >
      {subcategory ? (
        <T variant="small" tone="muted">
          The line&apos;s total is the sum of its entries.
        </T>
      ) : null}

      <Field label="What was it?" value={name} onChangeText={setName} placeholder="e.g. Keells run" autoFocus />
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0"
      />

      <View style={{ gap: space.sm }}>
        <Label>Day of month</Label>
        <DayPicker value={day} onChange={setDay} />
      </View>
    </BottomSheet>
  );
}
