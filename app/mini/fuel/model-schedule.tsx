import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Divider,
  GradientButton,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Field, PillSelect } from '~/shared/components/forms';
import type { VehicleTransmission } from '~/db/schema';
import { maintenanceOverrideRepo } from '~/db/repositories';
import { aiFillBlocked } from '~/features/ai/services/aiFill';
import { describeModel, type ScheduleProposal } from '~/features/fuel/logic/modelSchedule';
import {
  applyProposals,
  lookUpModelSchedule,
  resetSchedule,
} from '~/features/fuel/services/modelSchedule';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppActions, useAppSelector } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

const PROPOSAL_ICON: Record<ScheduleProposal['type'], keyof typeof Ionicons.glyphMap> = {
  change: 'swap-horizontal',
  off: 'remove-circle-outline',
  add: 'add-circle-outline',
};

/**
 * Match the schedule to the exact model.
 *
 * Make, model, year and engine first (saved on the vehicle either way), then
 * an AI lookup of that model's own maintenance schedule. The answer comes back
 * as a checklist of proposed changes — each "from → to" — and only the ticked
 * ones are applied, because a model can be confidently wrong about a manual.
 */
export default function ModelScheduleSheet() {
  const { colors, space, radius } = useTheme();
  const closeModal = useModalClose();
  const vehicles = useAppSelector((s) => s.vehicles);
  const { updateVehicle, refreshMiniAppData } = useAppActions();
  const { vehicle: vehicleId } = useLocalSearchParams<{ vehicle?: string }>();
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];

  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : '');
  const [engine, setEngine] = useState(vehicle?.engine ?? '');
  const [transmission, setTransmission] = useState<VehicleTransmission | null>(vehicle?.transmission ?? null);

  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ known: boolean; note: string | null; proposals: ScheduleProposal[] } | null>(
    null,
  );
  const [kept, setKept] = useState<Set<string>>(new Set());

  const existing = useMemo(
    () => (vehicle ? maintenanceOverrideRepo.byVehicle(vehicle.id) : []),
    [vehicle, vehicles],
  );
  const blocked = aiFillBlocked();

  if (!vehicle) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Your model">
        <Text tone="muted">Add a vehicle first.</Text>
      </BottomSheet>
    );
  }

  function details() {
    const y = Number.parseInt(year, 10);
    return {
      make: make.trim() || null,
      model: model.trim() || null,
      year: Number.isFinite(y) && y > 1950 && y <= new Date().getFullYear() + 1 ? y : null,
      engine: engine.trim() || null,
      transmission,
    };
  }

  function saveDetails() {
    if (!vehicle) return;
    updateVehicle(vehicle.id, details());
  }

  async function lookUp() {
    if (!vehicle) return;
    saveDetails();
    setLooking(true);
    setError(null);
    setResult(null);
    const answer = await lookUpModelSchedule({ ...vehicle, ...details() });
    setLooking(false);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setResult(answer);
    setKept(new Set(answer.proposals.map((p) => p.key)));
  }

  function apply() {
    if (!vehicle || !result) return;
    applyProposals(
      vehicle,
      result.proposals.filter((p) => kept.has(p.key)),
    );
    refreshMiniAppData();
    closeModal();
  }

  function confirmReset() {
    if (!vehicle) return;
    Alert.alert(
      "Back to Dayly's schedule?",
      'Every change made for this vehicle — by AI or by hand — is removed. What you recorded as done stays.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            resetSchedule(vehicle);
            refreshMiniAppData();
            closeModal();
          },
        },
      ],
    );
  }

  const name = describeModel(details());
  const keptCount = result ? result.proposals.filter((p) => kept.has(p.key)).length : 0;

  return (
    <BottomSheet
      visible
      asRoute
      onClose={() => {
        saveDetails();
        closeModal();
      }}
      title="Match your exact model"
      eyebrow={vehicle.name}
      icon="sparkles"
      iconColor={colors.accent}
      scroll
      footer={
        result && result.proposals.length > 0 ? (
          <GradientButton
            label={keptCount > 0 ? `Apply ${keptCount} change${keptCount === 1 ? '' : 's'}` : 'Nothing ticked'}
            icon="checkmark"
            onPress={apply}
            disabled={keptCount === 0}
          />
        ) : (
          <GradientButton
            label={blocked ? 'Save details' : 'Find my model’s schedule'}
            icon={blocked ? 'checkmark' : 'sparkles'}
            onPress={() => {
              if (blocked) {
                saveDetails();
                closeModal();
              } else void lookUp();
            }}
            disabled={looking || (!blocked && !(make.trim() && model.trim()))}
          />
        )
      }
    >
      <Text variant="small" tone="secondary">
        Dayly&apos;s schedule fits most {vehicle.kind === 'bike' ? 'bikes' : 'vehicles'} of this type. Your
        model&apos;s own manual may differ — a timing chain instead of a belt, a longer oil interval, the
        exact oil grade. AI looks it up; you choose what to keep.
      </Text>

      <View style={{ gap: space.md }}>
        <Label>YOUR VEHICLE</Label>
        <Row gap={space.sm}>
          <Field label="Make" value={make} onChangeText={setMake} placeholder="e.g. Toyota" style={{ flex: 1 }} />
          <Field label="Model" value={model} onChangeText={setModel} placeholder="e.g. Aqua" style={{ flex: 1 }} />
        </Row>
        <Row gap={space.sm}>
          <Field
            label="Year"
            value={year}
            onChangeText={setYear}
            placeholder="e.g. 2015"
            keyboardType="numeric"
            style={{ flex: 1 }}
          />
          <Field
            label="Engine (optional)"
            value={engine}
            onChangeText={setEngine}
            placeholder="e.g. 1NZ-FXE 1.5"
            style={{ flex: 1.4 }}
          />
        </Row>
        {vehicle.kind === 'bike' ? null : (
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
        <Text variant="caption" tone="muted">
          The year and engine code are on the registration book (CR) or under the bonnet.
        </Text>
      </View>

      {blocked ? (
        <Surface style={{ gap: space.xs }}>
          <Text variant="bodyStrong">AI is off</Text>
          <Text variant="small" tone="secondary">
            {blocked} You can still change any item&apos;s interval by hand from its page.
          </Text>
        </Surface>
      ) : null}

      {looking ? (
        <Surface>
          <Row align="center" style={{ gap: space.md }}>
            <ActivityIndicator color={colors.accent} />
            <Text variant="small" style={{ flex: 1 }}>
              Looking up the {name ?? 'model'} schedule…
            </Text>
          </Row>
        </Surface>
      ) : null}

      {error ? (
        <Surface>
          <Row align="flex-start" style={{ gap: space.sm }}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} style={{ marginTop: 1 }} />
            <Text variant="small" style={{ flex: 1 }}>
              {error}
            </Text>
          </Row>
        </Surface>
      ) : null}

      {result ? (
        <View style={{ gap: space.sm }}>
          <Label>FOR YOUR {name ? name.split(' · ')[0].toUpperCase() : 'MODEL'}</Label>
          {result.note ? (
            <Surface>
              <Row align="flex-start" style={{ gap: space.sm }}>
                <Ionicons name="sparkles" size={15} color={colors.accent} style={{ marginTop: 2 }} />
                <Text variant="small" style={{ flex: 1 }}>
                  {result.note}
                </Text>
              </Row>
            </Surface>
          ) : null}

          {!result.known ? (
            <Text variant="small" tone="secondary">
              AI does not know this model well enough to be sure, so nothing is suggested. Dayly keeps its
              schedule — check the spelling, or change items by hand from your owner&apos;s book.
            </Text>
          ) : result.proposals.length === 0 ? (
            <Text variant="small" tone="secondary">
              Your model&apos;s schedule matches Dayly&apos;s — nothing to change.
            </Text>
          ) : (
            <>
              <Text variant="caption" tone="secondary">
                Untick anything that does not match your owner&apos;s book. AI can be wrong.
              </Text>
              <Surface padded={false}>
                {result.proposals.map((p, index) => {
                  const on = kept.has(p.key);
                  return (
                    <View key={p.key}>
                      {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                      <Pressable
                        onPress={() =>
                          setKept((c) => {
                            const next = new Set(c);
                            if (next.has(p.key)) next.delete(p.key);
                            else next.add(p.key);
                            return next;
                          })
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: space.md,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={on ? colors.accent : colors.inkMuted}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Row align="center" style={{ gap: 6 }}>
                            <Ionicons name={PROPOSAL_ICON[p.type]} size={14} color={colors.inkSecondary} />
                            <Text variant="bodyStrong" style={{ flex: 1 }}>
                              {p.type === 'add' ? `New: ${p.title}` : p.title}
                            </Text>
                          </Row>
                          {p.before ? (
                            <Text
                              variant="caption"
                              tone="muted"
                              style={{ textDecorationLine: 'line-through' }}
                            >
                              {p.before}
                            </Text>
                          ) : null}
                          <Text variant="small" tone="secondary">
                            {p.after}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </Surface>
              <Button label="Look up again" icon="refresh" variant="ghost" onPress={() => void lookUp()} />
            </>
          )}
        </View>
      ) : null}

      {existing.length > 0 && !result ? (
        <View style={{ gap: space.sm }}>
          <Label>CHANGED FOR THIS VEHICLE</Label>
          <Surface style={{ gap: space.sm, borderRadius: radius.lg }}>
            <Text variant="small" tone="secondary">
              {existing.length} item{existing.length === 1 ? ' is' : 's are'} tailored to this vehicle
              {existing.some((o) => o.source === 'ai') ? ', some from an AI lookup' : ''}.
            </Text>
            <Button label="Reset to Dayly’s schedule" icon="refresh" variant="ghost" onPress={confirmReset} />
          </Surface>
        </View>
      ) : null}
    </BottomSheet>
  );
}
