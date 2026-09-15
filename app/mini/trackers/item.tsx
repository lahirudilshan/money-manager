import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, Button, GradientButton, Label, Text } from '~/shared/components/ui';
import { Field } from '~/shared/components/forms';
import { TRACKER_COLOR, TRACKER_TINT } from '~/features/refills/logic/refills';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * The things people actually track, offered as one-tap starts.
 *
 * A tracker that opens on three empty text fields asks the user to invent a
 * naming scheme before they have seen it work. These fill the whole form from
 * a single tap, and every field stays editable afterwards — they are a
 * shortcut, not a fixed catalogue.
 *
 * `expectedDays` is a rough community figure used ONLY until the item has real
 * history, at which point measurement replaces it (see `nextDue`).
 */
const PRESETS: {
  name: string;
  unitLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  expectedDays: number;
}[] = [
  { name: 'Gas cylinder', unitLabel: '12.5kg', icon: 'flame-outline', expectedDays: 90 },
  { name: 'Water bottle', unitLabel: '20L', icon: 'water-outline', expectedDays: 14 },
  { name: 'Water filter', unitLabel: 'cartridge', icon: 'funnel-outline', expectedDays: 180 },
  { name: 'Rice', unitLabel: '25kg bag', icon: 'nutrition-outline', expectedDays: 60 },
  { name: 'Printer ink', unitLabel: 'cartridge', icon: 'print-outline', expectedDays: 120 },
  { name: 'Toothbrush', unitLabel: 'one', icon: 'medical-outline', expectedDays: 90 },
];

/**
 * Add or edit a tracked item.
 *
 * Only the NAME is required. Everything else — what one unit is, how long you
 * think it lasts — is optional, because the add-on's whole promise is that it
 * works out the duration for you. Demanding an estimate up front would ask for
 * exactly the guess it exists to replace.
 */
export default function TrackedItemForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ id?: string }>();
  const store = useAppStore();

  const existing = params.id
    ? store.trackedItems.find((item) => item.id === params.id)
    : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [unitLabel, setUnitLabel] = useState(existing?.unitLabel ?? '');
  const [icon, setIcon] = useState<string>(existing?.icon ?? 'cube-outline');
  const [expectedDays, setExpectedDays] = useState(
    existing?.expectedDays ? String(existing.expectedDays) : '',
  );

  /*
   * Blank is valid — the estimate is optional — so an empty field must never
   * show an error. Only a typed value that cannot be a duration does.
   */
  const parsedDays = Number.parseInt(expectedDays, 10);
  const daysError =
    expectedDays.trim() === ''
      ? undefined
      : !Number.isFinite(parsedDays) || parsedDays < 1 || parsedDays > 3650
        ? 'Enter a number of days between 1 and 3650'
        : undefined;

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setName(preset.name);
    setUnitLabel(preset.unitLabel);
    setIcon(preset.icon);
    setExpectedDays(String(preset.expectedDays));
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || daysError) return;

    const patch = {
      name: trimmed,
      unitLabel: unitLabel.trim() || null,
      icon,
      expectedDays: expectedDays.trim() ? parsedDays : null,
    };

    if (existing) store.updateTrackedItem(existing.id, patch);
    else store.addTrackedItem(patch);

    router.back();
  }

  function remove() {
    if (!existing) return;

    Alert.alert(
      `Delete ${existing.name}?`,
      'Every entry and the whole price history goes with it. Archiving keeps the history and just hides the item.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive instead',
          onPress: () => {
            store.archiveTrackedItem(existing.id, true);
            router.back();
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            store.deleteTrackedItem(existing.id);
            // Back twice: the detail screen behind this sheet is now gone.
            router.back();
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
      title={existing ? existing.name : 'Track something'}
      icon="repeat-outline"
      iconColor={TRACKER_COLOR}
      footer={
        <GradientButton
          label={existing ? 'Save changes' : 'Start tracking'}
          icon="checkmark"
          disabled={!name.trim() || Boolean(daysError)}
          onPress={save}
        />
      }
    >
      {/* Presets only when adding — on an edit they would overwrite the name. */}
      {!existing ? (
        <View style={{ gap: space.sm }}>
          <Label>COMMON ONES</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset.name}
                onPress={() => applyPreset(preset)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.xs,
                  paddingVertical: space.sm,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill ?? 999,
                  backgroundColor:
                    name === preset.name ? TRACKER_TINT : colors.surfaceSunken,
                }}
              >
                <Ionicons
                  name={preset.icon}
                  size={15}
                  color={name === preset.name ? TRACKER_COLOR : colors.inkMuted}
                />
                <Text variant="small">{preset.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Gas cylinder"
        autoFocus={!existing}
      />

      <Field
        label="One of these is"
        value={unitLabel}
        onChangeText={setUnitLabel}
        placeholder="12.5kg"
      />
      <Text variant="small" tone="muted">
        Just a label — shown beside the name so you know which size you buy.
      </Text>

      <Field
        label="Roughly how long does one last?"
        value={expectedDays}
        onChangeText={setExpectedDays}
        placeholder="90"
        keyboardType="numeric"
        error={daysError}
      />
      <Text variant="small" tone="muted">
        Optional, in days. Only used until you have logged two of them — after that the real
        figure replaces it.
      </Text>

      {existing ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button
            label={existing.archived ? 'Put back in the list' : 'Archive this item'}
            icon={existing.archived ? 'arrow-undo-outline' : 'archive-outline'}
            variant="ghost"
            onPress={() => {
              store.archiveTrackedItem(existing.id, !existing.archived);
              router.back();
            }}
          />
          <Button label="Delete" icon="trash-outline" variant="danger" onPress={remove} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
