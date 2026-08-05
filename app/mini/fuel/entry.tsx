import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { BottomSheet, GradientButton, Label, Row, Surface, Text } from '../../../src/components/ui';
import { AmountField, Field, PillSelect } from '../../../src/components/forms';
import { ImageUploader } from '../../../src/components/ImageUploader';
import { FUEL_STATIONS } from '../../../src/data/fuelStations';
import { parseAmount } from '../../../src/core/money';
import { fuelEntryRepo } from '../../../src/db/repositories';
import { useModalClose } from '../../../src/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Log one visit to the pump.
 *
 * `Filled the tank` is the field that matters most and is therefore explained
 * rather than left as a bare switch: whether the tank was brimmed is what makes
 * the next consumption figure measurable at all (see core/fuel.ts).
 */
export default function FuelEntryScreen() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const router = useRouter();
  const state = useAppStore();
  const { vehicle: vehicleId } = useLocalSearchParams<{ vehicle?: string }>();

  const vehicle = useMemo(
    () => state.vehicles.find((v) => v.id === vehicleId) ?? state.vehicles[0],
    [state.vehicles, vehicleId],
  );

  const [odometer, setOdometer] = useState('');
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [station, setStation] = useState('');
  const [isFullTank, setIsFullTank] = useState(true);
  const [missedPrevious, setMissedPrevious] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);

  const odometerValue = Number.parseFloat(odometer.replace(/,/g, ''));
  const litresValue = Number.parseFloat(litres);
  const canSave =
    Boolean(vehicle) && Number.isFinite(odometerValue) && Number.isFinite(litresValue) && litresValue > 0;

  function handleSave() {
    if (!vehicle || !canSave) return;
    const totalMinor = parseAmount(amount);

    fuelEntryRepo.create({
      vehicleId: vehicle.id,
      filledAt: new Date(),
      odometer: odometerValue,
      litres: litresValue,
      isFullTank,
      missedPrevious,
      totalMinor: totalMinor ?? null,
      pricePerLitreMinor: totalMinor ? Math.round(totalMinor / litresValue) : null,
      station: station.trim() || null,
      imageUri,
    });

    state.refresh();
    router.back();
  }

  const unit = vehicle?.odometerUnit ?? 'km';

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Log a fill-up"
      eyebrow={vehicle?.name}
      icon="water-outline"
      iconColor={vehicle?.color ?? colors.accent}
      scroll
      footer={<GradientButton label="Save fill-up" icon="checkmark" onPress={handleSave} disabled={!canSave} />}
    >
      <Field
        label={`Odometer (${unit})`}
        value={odometer}
        onChangeText={setOdometer}
        placeholder="e.g. 47310"
        keyboardType="numeric"
        autoFocus
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
    </BottomSheet>
  );
}
