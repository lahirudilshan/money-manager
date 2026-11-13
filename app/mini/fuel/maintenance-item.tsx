import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheet,
  Button,
  Divider,
  FundingBar,
  GradientButton,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Field } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import {
  describeFirst,
  describeInterval,
  headline,
  progressOf,
} from '~/features/fuel/logic/maintenance';
import { describePart, guideFor, partFor } from '~/features/fuel/logic/maintenanceGuide';
import {
  syncAllMaintenanceReminders,
  vehicleMaintenancePlan,
} from '~/features/fuel/services/maintenanceReminders';
import { GROUP_ICON } from '~/features/fuel/components/maintenanceVisual';
import { removeItemFromVisit } from '~/features/fuel/services/serviceVisits';
import { SuggestionChips } from '~/features/fuel/components/SuggestionChips';
import { maintenanceMarkRepo, maintenanceOverrideRepo, vehicleServiceRepo } from '~/db/repositories';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppActions, useAppSelector } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One schedule item, explained for someone who has never opened a bonnet.
 *
 * Reads top to bottom as the questions a driver has: is it due? what even is
 * it? why should I care? how do I know it needs doing early? Then "I had it
 * done" — prefilled with today's reading and last time's brand, because the
 * usual case is the garage did the same job again.
 */
export default function MaintenanceItemSheet() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const router = useRouter();
  const vehicles = useAppSelector((s) => s.vehicles);
  const { addMaintenanceMark, removeMaintenanceMark, refreshMiniAppData } = useAppActions();
  const { vehicle: vehicleId, key } = useLocalSearchParams<{ vehicle?: string; key?: string }>();

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];
  const plan = useMemo(() => (vehicle ? vehicleMaintenancePlan(vehicle) : null), [vehicle, vehicles]);
  const entry = plan?.items.find((e) => e.item.key === key) ?? null;
  const marks = useMemo(
    () => (vehicle ? maintenanceMarkRepo.byVehicle(vehicle.id).filter((m) => m.itemKey === key) : []),
    [vehicle, vehicles, key],
  );
  const unit = vehicle?.odometerUnit ?? 'km';
  const parts = vehicle && key ? partFor(key, vehicle.kind, vehicle.fuelType) : null;
  const lastWithPart = marks.find((m) => m.action === 'done' && (m.brand || m.spec));
  /*
   * The garage for a record. A visit keeps it on the visit (its "Garage or
   * note"), not on each item it covered — read it from there, so editing the
   * visit later shows up here too.
   */
  const visitNotes = useMemo(
    () =>
      new Map(
        vehicle
          ? vehicleServiceRepo.byVehicle(vehicle.id).map((v) => [v.id, v.note ?? null] as const)
          : [],
      ),
    [vehicle, vehicles],
  );
  const noteOf = (mark: { note: string | null; serviceId: string | null }) =>
    mark.note ?? (mark.serviceId ? (visitNotes.get(mark.serviceId) ?? null) : null);
  const lastGarage =
    marks.filter((m) => m.action === 'done').map(noteOf).find((n): n is string => !!n) ?? '';

  const [odometer, setOdometer] = useState(() =>
    plan?.currentOdometer != null ? String(Math.round(plan.currentOdometer)) : '',
  );
  const [doneOn, setDoneOn] = useState(() => new Date());
  const [brand, setBrand] = useState(() => lastWithPart?.brand ?? '');
  const [spec, setSpec] = useState(() => lastWithPart?.spec ?? '');
  // Usually the same garage as last time — prefilled like the brand.
  const [note, setNote] = useState(lastGarage);
  const [editing, setEditing] = useState(false);
  const [editKm, setEditKm] = useState('');
  const [editMonths, setEditMonths] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const overrides = useMemo(
    () => (vehicle ? maintenanceOverrideRepo.byVehicle(vehicle.id) : []),
    [vehicle, vehicles],
  );

  if (!vehicle || !entry) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Maintenance">
        <Text tone="muted">This item is not on this vehicle&apos;s schedule.</Text>
      </BottomSheet>
    );
  }

  // A custom item (from the model lookup) explains itself with its own note.
  const guide = entry.item.custom
    ? { what: entry.item.detail || entry.item.title, why: "It is on your model's own maintenance schedule.", sooner: undefined, ask: undefined }
    : guideFor(entry.item.key);
  const override = overrides.find((o) => o.itemKey === entry.item.key) ?? null;
  const top = headline(entry, unit);
  const progress = progressOf(entry);
  const first = describeFirst(entry.item, unit);
  const notApplicable = entry.status === 'not_applicable';
  const accent =
    entry.status === 'overdue'
      ? colors.danger
      : entry.status === 'soon'
        ? colors.pending
        : entry.status === 'ok'
          ? colors.completed
          : colors.accent;
  const statusIcon =
    entry.status === 'overdue'
      ? 'alert-circle'
      : entry.status === 'soon'
        ? 'time'
        : entry.status === 'ok'
          ? 'checkmark-circle'
          : entry.status === 'not_applicable'
            ? 'remove-circle'
            : 'help-circle';

  function markDone() {
    if (!vehicle || !entry) return;
    const odo = Number.parseFloat(odometer.replace(/,/g, ''));
    addMaintenanceMark({
      vehicleId: vehicle.id,
      itemKey: entry.item.key,
      action: 'done',
      doneAt: doneOn,
      odometer: Number.isFinite(odo) ? odo : null,
      brand: brand.trim() || null,
      spec: spec.trim() || null,
      note: note.trim() || null,
    });
    closeModal();
  }

  function toggleApplicable() {
    if (!vehicle || !entry) return;
    if (notApplicable) {
      marks.filter((m) => m.action === 'not_applicable').forEach((m) => removeMaintenanceMark(m.id));
      // Turned off by the model lookup ("this model has a chain"): turn the override back on.
      if (override && !override.applies) {
        maintenanceOverrideRepo.put(vehicle.id, entry.item.key, { ...override, applies: true });
        refreshMiniAppData();
        void syncAllMaintenanceReminders(vehicles);
      }
      return;
    }
    addMaintenanceMark({
      vehicleId: vehicle.id,
      itemKey: entry.item.key,
      action: 'not_applicable',
      doneAt: new Date(),
    });
    closeModal();
  }

  function saveInterval() {
    if (!vehicle || !entry) return;
    const km = Number.parseFloat(editKm.replace(/,/g, ''));
    const months = Number.parseInt(editMonths, 10);
    maintenanceOverrideRepo.put(vehicle.id, entry.item.key, {
      title: override?.title ?? null,
      group: override?.group ?? null,
      action: override?.action ?? null,
      recommended: editSpec.trim() || null,
      detail: override?.detail ?? null,
      applies: true,
      everyKm: Number.isFinite(km) && km > 0 ? km : null,
      everyMonths: Number.isFinite(months) && months > 0 ? months : null,
      source: 'user',
    });
    setEditing(false);
    refreshMiniAppData();
    void syncAllMaintenanceReminders(vehicles);
  }

  function resetToDefault() {
    if (!vehicle || !entry) return;
    maintenanceOverrideRepo.remove(vehicle.id, entry.item.key);
    setEditing(false);
    refreshMiniAppData();
    void syncAllMaintenanceReminders(vehicles);
    if (entry.item.custom) closeModal();
  }

  function confirmRemoveFromVisit(serviceId: string) {
    if (!vehicle || !entry) return;
    const item = entry.item;
    Alert.alert(
      'Remove this record?',
      `It came from a service visit. ${item.title} is taken off that visit; the rest of the visit and its bill stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeItemFromVisit(vehicle, serviceId, item.key);
            refreshMiniAppData();
          },
        },
      ],
    );
  }

  function confirmRemove(id: string) {
    Alert.alert('Remove this record?', 'The schedule will count from the record before it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMaintenanceMark(id) },
    ]);
  }

  // Where the count starts, in words.
  const last = entry.lastDone;
  const lastLine = last
    ? last.source === 'purchase'
      ? `Counting from when you got it${last.odometer != null ? ` at ${Math.round(last.odometer).toLocaleString()} ${unit}` : ''}`
      : last.source === 'factory'
        ? 'Probably never changed — counting from 0'
        : [
            `Last done ${fmtDate(last.date)}`,
            last.odometer != null ? `at ${Math.round(last.odometer).toLocaleString()} ${unit}` : null,
          ]
            .filter(Boolean)
            .join(' ')
    : null;
  const lastPart = last ? (describePart(last) ?? last.partName ?? null) : null;

  const doneMarks = marks.filter((m) => m.action === 'done');

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title={entry.item.title}
      eyebrow={vehicle.name}
      icon={GROUP_ICON[entry.item.group]}
      iconColor={accent}
      scroll
      footer={
        notApplicable ? (
          <GradientButton label="Turn it back on" icon="refresh" onPress={toggleApplicable} />
        ) : (
          <GradientButton label="Save — it's done" icon="checkmark" onPress={markDone} />
        )
      }
    >
      {/* Is it due? The answer first, in the colour it carries on the list. */}
      <Surface style={{ gap: space.md }}>
        <Row align="center" style={{ gap: space.sm }}>
          <Ionicons name={statusIcon} size={22} color={accent} />
          <Text variant="heading" color={accent} style={{ flex: 1 }}>
            {top.title}
          </Text>
        </Row>
        {top.detail ? (
          <Text variant="small" tone="secondary">
            {top.detail}
          </Text>
        ) : null}
        {progress != null && !notApplicable ? (
          <View style={{ gap: 6 }}>
            <FundingBar pct={progress * 100} color={accent} />
            <Row justify="space-between">
              <Text variant="caption" tone="muted">
                {last?.odometer != null && entry.dueOdometer != null
                  ? `${Math.round(last.odometer).toLocaleString()} ${unit}`
                  : last
                    ? fmtDate(last.date)
                    : ''}
              </Text>
              <Text variant="caption" tone="muted">
                {last?.odometer != null && entry.dueOdometer != null
                  ? `${Math.round(entry.dueOdometer).toLocaleString()} ${unit}`
                  : entry.dueDate
                    ? fmtDate(entry.dueDate)
                    : ''}
              </Text>
            </Row>
          </View>
        ) : null}
        {lastLine || lastPart ? (
          <>
            <Divider />
            <View style={{ gap: 2 }}>
              {lastLine ? <Text variant="small">{lastLine}</Text> : null}
              {lastPart ? (
                <Text variant="caption" tone="secondary">
                  Used: {lastPart}
                </Text>
              ) : null}
              {last?.source === 'service' ? (
                <Text variant="caption" tone="muted">
                  Found in your service log
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </Surface>

      {/* What is it, and why care — the part most people never get told. */}
      <View style={{ gap: space.sm }}>
        <Label>WHAT IT IS</Label>
        <Surface style={{ gap: space.md }}>
          <Text variant="body">{guide.what}</Text>
          <View style={{ gap: 4 }}>
            <Text variant="bodyStrong">Why it matters</Text>
            <Text variant="small" tone="secondary">
              {guide.why}
            </Text>
          </View>
          <Divider />
          <Row align="center" style={{ gap: space.sm }}>
            <Ionicons name="repeat" size={16} color={colors.inkSecondary} />
            <Text variant="small" tone="secondary" style={{ flex: 1 }}>
              {describeInterval(entry.item, unit)}
            </Text>
            <Pressable
              onPress={() => {
                setEditKm(entry.item.everyKm ? String(entry.item.everyKm) : '');
                setEditMonths(entry.item.everyMonths ? String(entry.item.everyMonths) : '');
                setEditSpec(entry.item.recommended ?? '');
                setEditing((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel="Change how often"
              hitSlop={10}
            >
              <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
                {editing ? 'Cancel' : 'Change'}
              </Text>
            </Pressable>
          </Row>
          {entry.item.changedBy ? (
            <Text variant="caption" tone="muted">
              {entry.item.changedBy === 'ai'
                ? 'From the AI lookup for your model — check your owner’s book.'
                : 'Set by you for this vehicle.'}
            </Text>
          ) : null}
          {editing ? (
            <View style={{ gap: space.md }}>
              <Row gap={space.sm}>
                <Field
                  label={`Every (${unit})`}
                  value={editKm}
                  onChangeText={setEditKm}
                  placeholder="e.g. 10000"
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
                <Field
                  label="Or months"
                  value={editMonths}
                  onChangeText={setEditMonths}
                  placeholder="e.g. 12"
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
              </Row>
              <Field
                label="Spec for your model (optional)"
                value={editSpec}
                onChangeText={setEditSpec}
                placeholder={parts?.specPlaceholder ?? 'e.g. 0W-20, 3.4 L'}
              />
              <Text variant="caption" tone="muted">
                Use what your owner&apos;s book says. Leave a box empty to keep Dayly&apos;s value.
              </Text>
              <Row justify="space-between">
                {override ? (
                  <Button label={entry.item.custom ? 'Remove item' : 'Use Dayly’s'} variant="ghost" onPress={resetToDefault} />
                ) : (
                  <View />
                )}
                <Button label="Save" icon="checkmark" variant="secondary" onPress={saveInterval} />
              </Row>
            </View>
          ) : null}
          {entry.item.recommended ? (
            <Row align="flex-start" style={{ gap: space.sm }}>
              <Ionicons name="pricetag-outline" size={16} color={colors.inkSecondary} style={{ marginTop: 1 }} />
              <Text variant="small" style={{ flex: 1 }}>
                For your model: {entry.item.recommended}
              </Text>
            </Row>
          ) : null}
          {entry.item.modelNote ? (
            <Row align="flex-start" style={{ gap: space.sm }}>
              <Ionicons name="information-circle-outline" size={16} color={colors.inkSecondary} style={{ marginTop: 1 }} />
              <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                {entry.item.modelNote}
              </Text>
            </Row>
          ) : null}
          {first ? (
            <Row align="center" style={{ gap: space.sm }}>
              <Ionicons name="sparkles-outline" size={16} color={colors.inkSecondary} />
              <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                {first}
              </Text>
            </Row>
          ) : null}
        </Surface>
      </View>

      {guide.sooner?.length ? (
        <View style={{ gap: space.sm }}>
          <Label>DO IT SOONER IF YOU NOTICE</Label>
          <Surface style={{ gap: space.sm }}>
            {guide.sooner.map((sign) => (
              <Row key={sign} align="flex-start" style={{ gap: space.sm }}>
                <Ionicons name="eye-outline" size={15} color={colors.pending} style={{ marginTop: 2 }} />
                <Text variant="small" style={{ flex: 1 }}>
                  {sign}
                </Text>
              </Row>
            ))}
          </Surface>
        </View>
      ) : null}

      {guide.ask ? (
        <View style={{ gap: space.sm }}>
          <Label>AT THE GARAGE</Label>
          <Surface style={{ gap: space.xs }}>
            <Row align="flex-start" style={{ gap: space.sm }}>
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={16}
                color={colors.accent}
                style={{ marginTop: 2 }}
              />
              <Text variant="small" style={{ flex: 1 }}>
                {guide.ask}
              </Text>
            </Row>
          </Surface>
        </View>
      ) : null}

      {notApplicable ? null : (
        <View style={{ gap: space.md }}>
          <Label>I HAD IT DONE</Label>
          <DatePickerField label="When" value={doneOn} onChange={setDoneOn} />
          <Field
            label={`Odometer reading (${unit})`}
            value={odometer}
            onChangeText={setOdometer}
            placeholder="e.g. 48200"
            keyboardType="numeric"
          />
          {parts ? (
            <>
              {parts.brands.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <Field
                    label="Brand (optional)"
                    value={brand}
                    onChangeText={setBrand}
                    placeholder="Tap one below or type"
                  />
                  <SuggestionChips options={parts.brands} value={brand} onChange={setBrand} />
                </View>
              ) : null}
              <View style={{ gap: space.sm }}>
                <Field
                  label={`${parts.specLabel} (optional)`}
                  value={spec}
                  onChangeText={setSpec}
                  placeholder={parts.specPlaceholder}
                />
                <SuggestionChips options={parts.specs} value={spec} onChange={setSpec} />
                {parts.hint ? (
                  <Text variant="caption" tone="secondary">
                    {parts.hint}
                  </Text>
                ) : null}
              </View>
              {lastWithPart ? (
                <Text variant="caption" tone="muted">
                  Filled in from last time — change it if something different went in.
                </Text>
              ) : null}
            </>
          ) : null}
          <Field
            label="Garage or note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Done at the Toyota agent, Wattala"
          />
        </View>
      )}

      {doneMarks.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>PAST RECORDS</Label>
          <Surface padded={false}>
            {doneMarks.map((mark, index) => {
              const part = describePart(mark);
              return (
                <View key={mark.id}>
                  {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                  <Row
                    justify="space-between"
                    align="center"
                    style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="small" style={{ fontWeight: '700' }}>
                        {[
                          fmtDate(mark.doneAt),
                          mark.odometer != null
                            ? `${Math.round(mark.odometer).toLocaleString()} ${unit}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {part || noteOf(mark) ? (
                        <Text variant="caption" tone="secondary" numberOfLines={2}>
                          {[part, noteOf(mark)].filter(Boolean).join(' — ')}
                        </Text>
                      ) : null}
                    </View>
                    {mark.serviceId ? (
                      // Part of a visit: open it, or take just this item off
                      // it — the visit's bill updates too, so the two agree.
                      <Row align="center" style={{ gap: space.md }}>
                        <Pressable
                          onPress={() =>
                            router.push(`/mini/fuel/service-visit?vehicle=${vehicle.id}&id=${mark.serviceId}`)
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Open the service visit"
                          hitSlop={10}
                        >
                          <Row align="center" style={{ gap: 2 }}>
                            <Text variant="caption" tone="accent">
                              Visit
                            </Text>
                            <Ionicons name="chevron-forward" size={14} color={colors.accent} />
                          </Row>
                        </Pressable>
                        <Pressable
                          onPress={() => confirmRemoveFromVisit(mark.serviceId!)}
                          accessibilityRole="button"
                          accessibilityLabel="Remove this record"
                          hitSlop={10}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.danger} />
                        </Pressable>
                      </Row>
                    ) : (
                      <Pressable
                        onPress={() => confirmRemove(mark.id)}
                        accessibilityRole="button"
                        accessibilityLabel="Remove record"
                        hitSlop={10}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.danger} />
                      </Pressable>
                    )}
                  </Row>
                </View>
              );
            })}
          </Surface>
        </View>
      ) : null}

      {notApplicable ? null : (
        <Button
          label={
            entry.item.oftenNotApplicable
              ? "My vehicle doesn't have this"
              : "This doesn't apply to my vehicle"
          }
          variant="ghost"
          onPress={toggleApplicable}
        />
      )}
    </BottomSheet>
  );
}
