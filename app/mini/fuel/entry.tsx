import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import { BottomSheet, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { AmountField, Field, PillSelect } from '~/shared/components/forms';
import { ImageUploader } from '~/shared/components/ImageUploader';
import { FUEL_STATIONS } from '~/features/fuel/logic/fuelStations';
import { formatAmountInput, parseAmount } from '~/shared/lib/money';
import { fuelEntryRepo } from '../../../src/db/repositories';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Log one visit to the pump — or correct one already logged.
 *
 * `Filled the tank` is the field that matters most and is therefore explained
 * rather than left as a bare switch: whether the tank was brimmed is what makes
 * the next consumption figure measurable at all (see core/fuel.ts).
 *
 * Add and edit are ONE screen, reached with or without an `id`. They ask for
 * exactly the same seven fields against the same validation, and keeping them
 * apart would mean two forms drifting out of step — the edit form quietly
 * missing a switch that decides whether a tank is measurable at all.
 */
export default function FuelEntryScreen() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const router = useRouter();
  const state = useAppStore();
  const { vehicle: vehicleId, id: entryId } = useLocalSearchParams<{
    vehicle?: string;
    id?: string;
  }>();

  /*
   * Read once, on mount, and never again.
   *
   * Re-reading on every render would overwrite what is being typed each time
   * the store changes underneath — the row in the database is the value the
   * user is in the middle of replacing.
   */
  const existing = useMemo(
    () => (entryId ? fuelEntryRepo.byId(entryId) : null),
    [entryId],
  );
  const editing = existing !== null;

  // When editing, the row's OWN vehicle wins over the query param — the entry
  // being corrected belongs where it was logged, not wherever the list was.
  const vehicle = useMemo(
    () =>
      state.vehicles.find((v) => v.id === (existing?.vehicleId ?? vehicleId)) ??
      state.vehicles[0],
    [state.vehicles, vehicleId, existing],
  );

  const [odometer, setOdometer] = useState(() =>
    existing ? String(existing.odometer) : '',
  );
  const [litres, setLitres] = useState(() => (existing ? String(existing.litres) : ''));
  const [amount, setAmount] = useState(() =>
    existing?.totalMinor != null
      ? formatAmountInput(String(existing.totalMinor / 100))
      : '',
  );
  const [station, setStation] = useState(existing?.station ?? '');
  const [isFullTank, setIsFullTank] = useState(existing?.isFullTank ?? true);
  const [missedPrevious, setMissedPrevious] = useState(existing?.missedPrevious ?? false);
  const [imageUri, setImageUri] = useState<string | null>(existing?.imageUri ?? null);

  const odometerValue = Number.parseFloat(odometer.replace(/,/g, ''));
  const litresValue = Number.parseFloat(litres);
  const canSave =
    Boolean(vehicle) && Number.isFinite(odometerValue) && Number.isFinite(litresValue) && litresValue > 0;

  function handleSave() {
    if (!vehicle || !canSave) return;
    const totalMinor = parseAmount(amount);

    const fields = {
      vehicleId: vehicle.id,
      odometer: odometerValue,
      litres: litresValue,
      isFullTank,
      missedPrevious,
      totalMinor: totalMinor ?? null,
      pricePerLitreMinor: totalMinor ? Math.round(totalMinor / litresValue) : null,
      station: station.trim() || null,
      imageUri,
    };

    if (existing) {
      // `filledAt` is deliberately not in `fields`: correcting a typed litre
      // count should not restamp WHEN the tank was filled, and re-dating it
      // would silently reorder the log.
      fuelEntryRepo.update(existing.id, fields);
    } else {
      fuelEntryRepo.create({ ...fields, filledAt: new Date() });
    }

    state.refresh();
    router.back();
  }

  function handleDelete() {
    if (!existing) return;
    Alert.alert(
      'Delete this fill-up?',
      /* Naming the consequence, because it is not local to this row: every
         consumption figure is measured BETWEEN fills, so removing one merges
         two windows into a longer one and changes the km/L either side. */
      'Removing it also changes the mileage measured either side of it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            fuelEntryRepo.remove(existing.id);
            state.refresh();
            router.back();
          },
        },
      ],
    );
  }

  const unit = vehicle?.odometerUnit ?? 'km';

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title={editing ? 'Edit fill-up' : 'Log a fill-up'}
      eyebrow={vehicle?.name}
      icon="water-outline"
      iconColor={vehicle?.color ?? colors.accent}
      scroll
      footer={
        <GradientButton
          label={editing ? 'Save changes' : 'Save fill-up'}
          icon="checkmark"
          onPress={handleSave}
          disabled={!canSave}
        />
      }
    >
      <Field
        label={`Odometer (${unit})`}
        value={odometer}
        onChangeText={setOdometer}
        placeholder="e.g. 47310"
        keyboardType="numeric"
        autoFocus={!editing}
      />

      <Field
        label="Litres"
        value={litres}
        onChangeText={setLitres}
        placeholder="e.g. 33.8"
        keyboardType="decimal-pad"
      />

      <AmountField
        label="What it cost"
        value={amount}
        onChangeText={setAmount}
        currency={state.currency}
        hero={false}
      />

      {/* A fixed list rather than free text: the station is only useful if it
          is spelled the same way every time, and a typed field accumulates
          "Ceypetco"/"CEYPETCO"/"ceypetco " over a year of fill-ups. */}
      <PillSelect
        label="Station"
        options={FUEL_STATIONS.map((s) => ({ key: s.name, label: s.name }))}
        selectedKey={station}
        onSelect={(key) => setStation(key === station ? '' : key)}
      />

      {/*
        A photo of the ODOMETER, not the receipt.

        The reading is the one figure here that cannot be recovered later: the
        litres and the price are on a slip and in the bank alert, but the
        odometer exists only on the dash at the moment of filling. A shot of it
        is what lets a mistyped reading be corrected months on — and a wrong
        odometer silently corrupts every consumption figure after it.
      */}
      <ImageUploader label="Odometer photo" value={imageUri} onChange={setImageUri} />

      <Surface style={{ gap: space.md }}>
        <Row justify="space-between" align="center">
          <View style={{ flex: 1, paddingRight: space.md }}>
            <Text variant="body">Filled the tank</Text>
            <Text variant="caption" tone="muted">
              Consumption can only be measured between two brim-full tanks. A part-fill still counts
              toward the next one.
            </Text>
          </View>
          <Switch value={isFullTank} onValueChange={setIsFullTank} accessibilityLabel="Filled the tank" />
        </Row>

        <Row justify="space-between" align="center">
          <View style={{ flex: 1, paddingRight: space.md }}>
            <Text variant="body">I missed logging one</Text>
            <Text variant="caption" tone="muted">
              Breaks the chain, so a stretch with unrecorded fuel is not reported as a great tank.
            </Text>
          </View>
          <Switch
            value={missedPrevious}
            onValueChange={setMissedPrevious}
            accessibilityLabel="Missed a previous fill-up"
          />
        </Row>
      </Surface>

      {/* Far from Save, and only when there is something to delete. */}
      {editing ? (
        <Pressable
          onPress={handleDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete this fill-up"
          style={({ pressed }) => ({
            alignItems: 'center',
            paddingVertical: space.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="small" color={colors.danger} style={{ fontWeight: '600' }}>
            Delete this fill-up
          </Text>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}
