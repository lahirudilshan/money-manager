import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, Button, GradientButton, Label, Text } from '~/shared/components/ui';
import { AmountField, Field, PillSelect } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { formatAmountInput, formatMoney, parseAmount } from '~/shared/lib/money';
import { describeDays, TRACKER_COLOR } from '~/features/refills/logic/refills';
import { refillRepo } from '~/db/repositories/trackers';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Log a replacement.
 *
 * The date and the price are the whole form. Nothing about quantity is asked,
 * because the duration this add-on reports is measured from the DATES — asking
 * for a weight or a level would be asking the user to maintain a gauge that the
 * act of refilling already measures for free.
 *
 * ## The expense switch
 *
 * Off by default, and that default matters. Smart Detect already catches the
 * same purchase from the bank SMS for anyone who pastes their messages, so
 * writing a transaction here as well would count the cylinder twice. The price
 * is kept for the chart either way — the switch only decides whether the money
 * also lands on a budget line.
 */
export default function RefillForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ itemId?: string; id?: string }>();

  const items = useAppStore((s) => s.trackedItems);
  const subcategories = useAppStore((s) => s.subcategories);
  const currency = useAppStore((s) => s.currency);
  const addRefill = useAppStore((s) => s.addRefill);
  const updateRefill = useAppStore((s) => s.updateRefill);
  const deleteRefill = useAppStore((s) => s.deleteRefill);

  const item = items.find((candidate) => candidate.id === params.itemId);
  const existing = params.id ? refillRepo.byId(params.id) : undefined;

  const [filledOn, setFilledOn] = useState<Date>(existing?.filledOn ?? new Date());
  const [price, setPrice] = useState(
    existing?.priceMinor != null ? formatAmountInput(String(existing.priceMinor / 100)) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');

  /*
   * Editing never re-opens the expense question.
   *
   * A refill that already wrote a transaction owns it, and one that did not
   * should not gain one on an unrelated edit — either would change the budget
   * from a screen the user opened to fix a date.
   */
  const [alsoLog, setAlsoLog] = useState(false);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);

  const expenseLines = subcategories.filter((sub) => sub.type === 'expense');
  const priceMinor = price.trim() ? parseAmount(price) : null;
  const priceError = price.trim() && priceMinor === null ? 'Enter a valid amount' : undefined;

  /** How long the one being replaced lasted — shown as confirmation, not input. */
  const previous = item
    ? refillRepo
        .forItem(item.id)
        .filter((row) => row.id !== existing?.id && row.filledOn < filledOn)
        .sort((a, b) => b.filledOn.getTime() - a.filledOn.getTime())[0]
    : undefined;

  const lasted = previous
    ? Math.round((filledOn.getTime() - previous.filledOn.getTime()) / 86_400_000)
    : null;

  const canSave = Boolean(item) && !priceError && (!alsoLog || Boolean(subcategoryId));

  function save() {
    if (!item || !canSave) return;

    if (existing) {
      updateRefill(existing.id, {
        filledOn,
        priceMinor,
        note: note.trim() || null,
      });
    } else {
      addRefill(
        { itemId: item.id, filledOn, priceMinor, note: note.trim() || null },
        alsoLog && subcategoryId
          ? { subcategoryId, name: item.name }
          : null,
      );
    }

    router.back();
  }

  function remove() {
    if (!existing) return;
    Alert.alert(
      'Delete this entry?',
      'It will stop counting towards how long this item lasts. Any expense it created is removed too.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteRefill(existing.id);
            router.back();
          },
        },
      ],
    );
  }

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title={existing ? 'Edit entry' : `Replaced ${item?.name ?? 'it'}`}
      icon="repeat-outline"
      iconColor={TRACKER_COLOR}
      footer={
        <GradientButton
          label={existing ? 'Save changes' : 'Log it'}
          icon="checkmark"
          disabled={!canSave}
          onPress={save}
        />
      }
    >
      <DatePickerField label="When" value={filledOn} onChange={setFilledOn} />

      {/*
        The measurement, stated the moment it can be. This is the add-on's whole
        output, and showing it here — before the refill is even saved — is what
        makes the logging feel worth doing.
      */}
      {lasted !== null && lasted > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: 'rgba(5,150,105,0.10)',
          }}
        >
          <Ionicons name="time-outline" size={18} color="#059669" />
          <Text variant="small" style={{ flex: 1 }}>
            That one lasted <Text style={{ fontWeight: '700' }}>{describeDays(lasted)}</Text>.
          </Text>
        </View>
      ) : null}

      <AmountField
        label="What it cost"
        value={price}
        onChangeText={setPrice}
        currency={currency}
        hero={false}
        error={priceError}
      />
      <Text variant="small" tone="muted">
        Optional — leave it blank and this still counts towards how long the item lasts.
      </Text>

      {/*
        Only offered on a NEW refill with a price, and only when there is a line
        to put it on. An edit never re-opens the question — see `alsoLog`.
      */}
      {!existing && priceMinor !== null && expenseLines.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Pressable
            onPress={() => setAlsoLog((value) => !value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingVertical: space.sm,
            }}
          >
            <Ionicons
              name={alsoLog ? 'checkbox' : 'square-outline'}
              size={22}
              color={alsoLog ? TRACKER_COLOR : colors.inkMuted}
            />
            <View style={{ flex: 1 }}>
              <Text variant="body">Also log as an expense</Text>
              <Text variant="small" tone="muted">
                Leave off if your bank SMS already covers it
              </Text>
            </View>
          </Pressable>

          {alsoLog ? (
            <PillSelect
              label="WHICH LINE"
              options={expenseLines.map((sub) => ({ key: sub.id, label: sub.name }))}
              selectedKey={subcategoryId}
              onSelect={setSubcategoryId}
            />
          ) : null}
        </View>
      ) : null}

      <Field
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder="Bought from the corner shop"
      />

      {existing ? (
        <View style={{ marginTop: space.md }}>
          <Button label="Delete" icon="trash-outline" variant="danger" onPress={remove} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
