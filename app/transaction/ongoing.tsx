import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Field } from '~/shared/components/forms';
import { BottomSheet, GradientButton, Text } from '~/shared/components/ui';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { ImageUploader } from '~/shared/components/ImageUploader';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { parseAmount } from '~/shared/lib/money';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Add one entry to a line — a single grocery run under "Groceries", or one half
 * of a rent payment under "Rent".
 *
 * Opened from any subcategory's "Add" action. The route is named for the
 * ongoing lines that first had entries; one-payment bills take them too now,
 * since a bill is often met in several movements. Deliberately minimal: what,
 * how much, and when.
 */
export default function AddOngoingTransaction() {
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
  // Defaults to today — the overwhelmingly common case is logging an entry the
  // day it happened, so that costs no taps and back-dating stays possible.
  const [date, setDate] = useState(() => new Date());
  /*
   * The slip for THIS entry.
   *
   * It used to live on the subcategory screen, where it attached to the month
   * rather than to a payment — so a line with three entries had one shared
   * photo and no way to say which movement it belonged to. A receipt is
   * evidence of one payment, so it belongs beside that payment's amount.
   */
  const [imageUri, setImageUri] = useState<string | null>(null);

  const amountMinor = parseAmount(amount) ?? 0;
  const canSave = Boolean(subcategoryId) && name.trim().length > 0 && amountMinor > 0;

  function handleSave() {
    if (!canSave || !subcategoryId) return;
    // The chosen date decides the month this counts toward (the store derives
    // the period from it), so an entry back-dated into last month lands there
    // rather than being forced into whichever month is on screen.
    state.addTransaction({ subcategoryId, name: name.trim(), amountMinor, date, imageUri });
    closeModal();
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Add entry"
      eyebrow={subcategory ? `Entry in ${subcategory.name}` : undefined}
      icon="add-circle-outline"
      iconColor={colors.accent}
      scroll
      footer={<GradientButton label="Add entry" icon="add" onPress={handleSave} disabled={!canSave} />}
    >
      {subcategory ? (
        <Text variant="small" tone="muted">
          The line&apos;s total is the sum of its entries.
        </Text>
      ) : null}

      <Field label="What was it?" value={name} onChangeText={setName} placeholder="e.g. Keells run" autoFocus />
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        money
        placeholder="0"
      />

      <DatePickerField label="Date" value={date} onChange={setDate} />

      {/* Nothing is saved until "Add entry", so a picked-then-replaced photo
          has no stored row pointing at it yet — deleting the old file on
          replace is safe here, unlike on an edit screen. */}
      <ImageUploader label="Slip / receipt" value={imageUri} onChange={setImageUri} size={140} />
    </BottomSheet>
  );
}
