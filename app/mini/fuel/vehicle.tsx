import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { Divider, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import { Field, PillSelect } from '~/shared/components/forms';
import { ImageUploader } from '~/shared/components/ImageUploader';
import { fuelEntryRepo } from '../../../src/db/repositories';
import { FUEL_TYPE_LABEL, VEHICLE_KIND_LABEL, type FuelType, type VehicleKind } from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** Icon per vehicle kind, so the switcher chips read at a glance. */
const KIND_ICON: Record<VehicleKind, keyof typeof Ionicons.glyphMap> = {
  car: 'car-sport-outline',
  bike: 'bicycle-outline',
  van: 'bus-outline',
  three_wheeler: 'car-outline',
  other: 'ellipsis-horizontal-outline',
};

/** Manage vehicles: the existing list, and a form to add one. */
export default function VehiclesScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const state = useAppStore();

  const [adding, setAdding] = useState(state.vehicles.length === 0);
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [kind, setKind] = useState<VehicleKind>('car');
  const [fuelType, setFuelType] = useState<FuelType>('petrol');
  const [imageUri, setImageUri] = useState<string | null>(null);

  function handleSave() {
    if (!name.trim()) return;
    state.addVehicle({
      name: name.trim(),
      registration: registration.trim() || null,
      kind,
      fuelType,
      icon: KIND_ICON[kind],
      color: kind === 'bike' ? '#0F6FDE' : '#0E9F6E',
      odometerUnit: 'km',
      imageUri,
    });
    setName('');
    setRegistration('');
    setImageUri(null);
    setAdding(false);
  }

  function confirmDelete(id: string, label: string) {
    Alert.alert(`Delete ${label}?`, 'Its fill-ups and service records go with it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => state.deleteVehicle(id) },
    ]);
  }

  return (
    <Screen
      title="Vehicles"
      onBack={() => router.back()}
      footer={
        adding ? (
          <GradientButton label="Add vehicle" icon="checkmark" onPress={handleSave} disabled={!name.trim()} />
        ) : (
          <GradientButton label="Add another vehicle" icon="add" onPress={() => setAdding(true)} />
        )
      }
    >
      {state.vehicles.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>YOUR VEHICLES</Label>
          <Surface padded={false}>
            {state.vehicles.map((v, index) => (
              <View key={v.id}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <Row gap={space.md} style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                  {v.imageUri ? (
                    <Image
                      source={{ uri: v.imageUri }}
                      style={{ width: 36, height: 36, borderRadius: 12 }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: `${v.color}1A`,
                      }}
                    >
                      <Ionicons name={(v.icon as never) ?? 'car-outline'} size={18} color={v.color} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text variant="body">{v.name}</Text>
                    <Text variant="caption" tone="muted">
                      {[v.registration, FUEL_TYPE_LABEL[v.fuelType], `${fuelEntryRepo.byVehicle(v.id).length} fill-ups`]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => confirmDelete(v.id, v.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${v.name}`}
                    hitSlop={10}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </Row>
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {adding ? (
        <View style={{ gap: space.lg }}>
          <Label>NEW VEHICLE</Label>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Toyota Aqua" autoFocus />
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
          {/* Take one now or pick an existing shot — both ways in are offered
              directly, since either is equally likely. */}
          <ImageUploader label="Photo" value={imageUri} onChange={setImageUri} />
        </View>
      ) : null}
    </Screen>
  );
}
