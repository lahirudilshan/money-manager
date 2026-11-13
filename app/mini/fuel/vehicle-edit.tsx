import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet, Button, GradientButton, Label, Row, Text } from '~/shared/components/ui';
import { Field, PillSelect } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import {
  FUEL_TYPE_LABEL,
  VEHICLE_KIND_LABEL,
  type FuelType,
  type VehicleCondition,
  type VehicleKind,
  type VehicleTransmission,
} from '~/db/schema';
import { aiFillBlocked } from '~/features/ai/services/aiFill';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppActions, useAppSelector } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Everything about one vehicle, editable in one place.
 *
 * The exact model (make, model, year, engine, gearbox) is what the schedule is
 * matched to; when and at what reading it was got is what the schedule — and
 * the "km a month" behind every estimate — counts from. Those used to be
 * filled with the day the car was ADDED to Dayly, so they are asked here.
 */
export default function VehicleEditSheet() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const router = useRouter();
  const vehicles = useAppSelector((s) => s.vehicles);
  const { updateVehicle } = useAppActions();
  const { vehicle: vehicleId } = useLocalSearchParams<{ vehicle?: string }>();
  const vehicle = vehicles.find((v) => v.id === vehicleId);

  const [name, setName] = useState(vehicle?.name ?? '');
  const [registration, setRegistration] = useState(vehicle?.registration ?? '');
  const [kind, setKind] = useState<VehicleKind>(vehicle?.kind ?? 'car');
  const [fuelType, setFuelType] = useState<FuelType>(vehicle?.fuelType ?? 'petrol');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : '');
  const [engine, setEngine] = useState(vehicle?.engine ?? '');
  const [transmission, setTransmission] = useState<VehicleTransmission | null>(vehicle?.transmission ?? null);
  const [condition, setCondition] = useState<VehicleCondition | null>(vehicle?.condition ?? null);
  const [gotOn, setGotOn] = useState<Date>(vehicle?.acquiredAt ?? vehicle?.createdAt ?? new Date());
  const [serviceKm, setServiceKm] = useState(
    vehicle?.serviceIntervalKm ? String(Math.round(vehicle.serviceIntervalKm)) : '',
  );
  const [serviceMonths, setServiceMonths] = useState<number | null>(vehicle?.serviceIntervalMonths ?? null);
  const [gotAt, setGotAt] = useState(
    vehicle?.acquiredOdometer != null ? String(Math.round(vehicle.acquiredOdometer)) : '',
  );

  if (!vehicle) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Vehicle">
        <Text tone="muted">This vehicle was not found.</Text>
      </BottomSheet>
    );
  }

  const unit = vehicle.odometerUnit;

  function save(): boolean {
    if (!vehicle || !name.trim()) return false;
    const y = Number.parseInt(year, 10);
    const odo = Number.parseFloat(gotAt.replace(/,/g, ''));
    updateVehicle(vehicle.id, {
      name: name.trim(),
      registration: registration.trim() || null,
      kind,
      fuelType,
      make: make.trim() || null,
      model: model.trim() || null,
      year: Number.isFinite(y) && y > 1950 && y <= new Date().getFullYear() + 1 ? y : null,
      engine: engine.trim() || null,
      transmission: kind === 'bike' ? null : transmission,
      condition,
      acquiredAt: gotOn,
      acquiredOdometer: Number.isFinite(odo) ? odo : condition === 'new' ? 0 : null,
      serviceIntervalKm: (() => {
        const km = Number.parseFloat(serviceKm.replace(/,/g, ''));
        return Number.isFinite(km) && km >= 500 ? km : null;
      })(),
      serviceIntervalMonths: serviceMonths,
    });
    return true;
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Edit vehicle"
      eyebrow={vehicle.name}
      icon="car-sport"
      iconColor={vehicle.color}
      scroll
      footer={
        <GradientButton
          label="Save changes"
          icon="checkmark"
          disabled={!name.trim()}
          onPress={() => {
            if (save()) closeModal();
          }}
        />
      }
    >
      <View style={{ gap: space.md }}>
        <Label>THE BASICS</Label>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Hyundai Venue" />
        <Field
          label="Registration (optional)"
          value={registration}
          onChangeText={setRegistration}
          placeholder="e.g. CAR-1234"
        />
        <PillSelect
          label="Type"
          options={(Object.keys(VEHICLE_KIND_LABEL) as VehicleKind[]).map((key) => ({
            key,
            label: VEHICLE_KIND_LABEL[key],
          }))}
          selectedKey={kind}
          onSelect={(key) => setKind(key as VehicleKind)}
        />
        <PillSelect
          label="Fuel"
          options={(Object.keys(FUEL_TYPE_LABEL) as FuelType[]).map((key) => ({
            key,
            label: FUEL_TYPE_LABEL[key],
          }))}
          selectedKey={fuelType}
          onSelect={(key) => setFuelType(key as FuelType)}
        />
      </View>

      <View style={{ gap: space.md }}>
        <Label>EXACT MODEL</Label>
        <Row gap={space.sm}>
          <Field label="Make" value={make} onChangeText={setMake} placeholder="Hyundai" style={{ flex: 1 }} />
          <Field label="Model" value={model} onChangeText={setModel} placeholder="Venue N Line" style={{ flex: 1 }} />
        </Row>
        <Row gap={space.sm}>
          <Field
            label="Year"
            value={year}
            onChangeText={setYear}
            placeholder="2025"
            keyboardType="numeric"
            style={{ flex: 1 }}
          />
          <Field
            label="Engine (optional)"
            value={engine}
            onChangeText={setEngine}
            placeholder="e.g. 1.0 T-GDi"
            style={{ flex: 1.4 }}
          />
        </Row>
        {kind === 'bike' ? null : (
          <PillSelect
            label="Gearbox (optional)"
            singleRow
            options={[
              { key: 'automatic', label: 'Automatic' },
              { key: 'cvt', label: 'CVT' },
              { key: 'manual', label: 'Manual' },
            ]}
            selectedKey={transmission}
            onSelect={(key) =>
              setTransmission((current) => (current === key ? null : (key as VehicleTransmission)))
            }
          />
        )}
        {aiFillBlocked() ? null : (
          <Button
            label="Match the maintenance schedule to this model"
            icon="sparkles-outline"
            variant="secondary"
            disabled={!(make.trim() && model.trim())}
            onPress={() => {
              if (save()) router.push(`/mini/fuel/model-schedule?vehicle=${vehicle.id}`);
            }}
          />
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Label>SERVICED EVERY</Label>
        <PillSelect
          singleRow
          options={(kind === 'bike' || kind === 'three_wheeler' ? ['2000', '3000', '5000'] : ['5000', '7500', '10000', '15000']).map((km) => ({
            key: km,
            label: `${Number(km).toLocaleString()} ${unit}`,
          }))}
          selectedKey={serviceKm}
          onSelect={(key) => setServiceKm((current) => (current === key ? '' : key))}
        />
        <Row gap={space.sm} align="flex-end">
          <Field
            label={`Or type it (${unit})`}
            value={serviceKm}
            onChangeText={setServiceKm}
            placeholder="e.g. 10000"
            keyboardType="numeric"
            style={{ flex: 1 }}
          />
          <View style={{ flex: 1.3 }}>
            <PillSelect
              label="Or every"
              singleRow
              options={[
                { key: '6', label: '6 mo' },
                { key: '12', label: '12 mo' },
              ]}
              selectedKey={serviceMonths ? String(serviceMonths) : null}
              onSelect={(key) =>
                setServiceMonths((current) => (String(current) === key ? null : Number(key)))
              }
            />
          </View>
        </Row>
        <Text variant="caption" tone="secondary">
          What your dealer or service book says — whichever comes first. Next services are planned as
          these visits, and the oil change follows this interval. Leave empty to plan by each part instead.
        </Text>
      </View>

      <View style={{ gap: space.md }}>
        <Label>WHEN YOU GOT IT</Label>
        <PillSelect
          singleRow
          options={[
            { key: 'new', label: 'Brand new' },
            { key: 'used', label: 'Used' },
          ]}
          selectedKey={condition}
          onSelect={(key) => setCondition(key as VehicleCondition)}
        />
        <DatePickerField label="Got it on" value={gotOn} onChange={setGotOn} />
        <Field
          label={`Odometer then (${unit})`}
          value={gotAt}
          onChangeText={setGotAt}
          placeholder={condition === 'new' ? 'e.g. 28' : 'e.g. 64000'}
          keyboardType="numeric"
        />
        <Text variant="caption" tone="secondary">
          The schedule counts from here, and so does &quot;how far you drive a month&quot; — the basis of every
          &quot;due in about 8 weeks&quot;. The date is on your purchase papers or first service record.
        </Text>
      </View>

      <Text variant="caption" tone="muted" style={{ color: colors.inkMuted }}>
        Delete the vehicle from the Vehicles list.
      </Text>
    </BottomSheet>
  );
}
