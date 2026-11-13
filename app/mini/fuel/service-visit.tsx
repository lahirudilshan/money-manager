import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
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
import { AmountField, Field, PillSelect } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { AiScanCard, type ReadOutcome } from '~/features/ai/components/AiScanCard';
import { SERVICE_KIND_LABEL, type ServiceKind } from '~/db/schema';
import { vehicleServiceRepo } from '~/db/repositories';
import { vehicleItems } from '~/features/fuel/services/maintenanceReminders';
import { describePart, partFor } from '~/features/fuel/logic/maintenanceGuide';
import {
  autoTitle,
  coveredKeys,
  detectPart,
  suggestItemKey,
  type DraftLine,
  type LineKind,
} from '~/features/fuel/logic/serviceVisit';
import {
  loadVisit,
  readInvoice,
  removeVisit,
  saveVisit,
} from '~/features/fuel/services/serviceVisits';
import { SuggestionChips } from '~/features/fuel/components/SuggestionChips';
import { formatMoney, parseAmount } from '~/shared/lib/money';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppActions, useAppSelector } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** A line while it is being edited — the numbers stay text until saved. */
interface EditLine extends DraftLine {
  id: string;
  qtyText: string;
  priceText: string;
  /** Came from the AI read and has not been touched — shown with a marker. */
  fromAi: boolean;
}

const KIND_OPTIONS: { key: LineKind; label: string }[] = [
  { key: 'part', label: 'Part' },
  { key: 'fluid', label: 'Oil / fluid' },
  { key: 'labour', label: 'Labour' },
  { key: 'other', label: 'Other' },
];

let lineSeq = 0;
const toEdit = (line: DraftLine, fromAi = false): EditLine => ({
  ...line,
  id: `l${(lineSeq += 1)}`,
  qtyText: String(line.quantity),
  priceText: line.unitPriceMinor ? String(line.unitPriceMinor / 100) : '',
  fromAi,
});

/**
 * One garage visit: what was done, what it cost, and which schedule items it
 * counts as.
 *
 * The invoice photo is the fast path — AI copies the lines and guesses what
 * each one is — but every guess is shown as a chip the user can tap to fix,
 * and everything can be typed by hand with no photo or no AI at all.
 */
export default function ServiceVisitSheet() {
  const { colors, space, radius } = useTheme();
  const closeModal = useModalClose();
  const vehicles = useAppSelector((s) => s.vehicles);
  const currency = useAppSelector((s) => s.currency);
  const { refreshMiniAppData } = useAppActions();
  const { vehicle: vehicleId, id } = useLocalSearchParams<{ vehicle?: string; id?: string }>();

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];
  const existing = useMemo(
    () => (vehicle && id ? (vehicleServiceRepo.byVehicle(vehicle.id).find((s) => s.id === id) ?? null) : null),
    [vehicle, id],
  );
  const initial = useMemo(
    () => (vehicle && existing ? loadVisit(vehicle, existing) : null),
    [vehicle, existing],
  );
  const schedule = useMemo(() => (vehicle ? vehicleItems(vehicle) : []), [vehicle]);
  const unit = vehicle?.odometerUnit ?? 'km';

  const [imageUri, setImageUri] = useState<string | null>(initial?.imageUri ?? null);
  const [servicedAt, setServicedAt] = useState<Date>(initial?.servicedAt ?? new Date());
  const [odometer, setOdometer] = useState(
    initial?.odometer != null ? String(Math.round(initial.odometer)) : '',
  );
  const [kind, setKind] = useState<ServiceKind>(initial?.kind ?? 'service');
  /*
   * The title writes itself from the visit (see `autoTitle`) and keeps up as
   * lines, kind and odometer change — until the user types their own. A saved
   * visit keeps the title it has. Clearing the field hands it back.
   */
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleTyped, setTitleTyped] = useState(Boolean(initial?.title));
  const [cost, setCost] = useState(initial?.costMinor ? String(initial.costMinor / 100) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [lines, setLines] = useState<EditLine[]>(() => (initial?.lines ?? []).map((l) => toEdit(l)));
  const [extraKeys, setExtraKeys] = useState<string[]>(initial?.extraKeys ?? []);
  const [openLine, setOpenLine] = useState<string | null>(null);


  if (!vehicle) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Service visit">
        <Text tone="muted">Add a vehicle first.</Text>
      </BottomSheet>
    );
  }

  const titleOf = (key: string) => schedule.find((i) => i.key === key)?.title ?? null;
  const lineKeys = new Set(lines.map((l) => l.itemKey).filter(Boolean));
  const covered = coveredKeys(lines, extraKeys);
  const linesTotal = lines.reduce(
    (sum, l) => sum + (Number.parseFloat(l.qtyText) || 1) * (parseAmount(l.priceText) ?? 0),
    0,
  );
  const aiLines = lines.filter((l) => l.fromAi).length;
  const odoNumber = Number.parseFloat(odometer.replace(/,/g, ''));
  const suggestedTitle = autoTitle(
    kind,
    covered.map((k) => schedule.find((i) => i.key === k)).filter((i) => !!i),
    { odometer: Number.isFinite(odoNumber) ? odoNumber : null, lines, serviceKm: vehicle.serviceIntervalKm },
  );

  async function readPhoto(uri: string): Promise<ReadOutcome> {
    if (!vehicle) return { ok: false, error: 'Add a vehicle first.' };
    const result = await readInvoice(uri, vehicle);
    if (!result.ok) return result;
    const inv = result.invoice;
    setLines(inv.lines.map((l) => toEdit(l, true)));
    if (inv.date) setServicedAt(inv.date);
    if (inv.odometer != null) setOdometer(String(Math.round(inv.odometer)));
    if (inv.totalMinor != null) setCost(String(inv.totalMinor / 100));
    if (inv.garage && !note.trim()) setNote(inv.garage);
    return {
      ok: true,
      note: `Read ${inv.lines.length} line${inv.lines.length === 1 ? '' : 's'}${
        inv.odometer == null ? ' — no odometer on it, please add one' : ''
      }.`,
    };
  }

  function patchLine(lineId: string, patch: Partial<EditLine>) {
    setLines((current) =>
      current.map((l) => (l.id === lineId ? { ...l, ...patch, fromAi: false } : l)),
    );
  }

  function addLine() {
    const line = toEdit({
      name: '',
      quantity: 1,
      unitPriceMinor: 0,
      kind: 'part',
      itemKey: '',
      brand: '',
      spec: '',
    });
    setLines((c) => [...c, line]);
    setOpenLine(line.id);
  }

  function renameLine(line: EditLine, name: string) {
    if (!vehicle) return;
    // Until the user picks one, the mapping follows the name as it is typed.
    const itemKey = line.itemKey || suggestItemKey(schedule, name);
    const detected = itemKey ? detectPart(itemKey, vehicle.kind, vehicle.fuelType, name) : null;
    patchLine(line.id, {
      name,
      itemKey,
      brand: line.brand || detected?.brand || '',
      spec: line.spec || detected?.spec || '',
    });
  }

  function toggleExtra(key: string) {
    if (lineKeys.has(key)) return;
    setExtraKeys((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  }

  function save() {
    if (!vehicle) return;
    const odo = Number.parseFloat(odometer.replace(/,/g, ''));
    const clean: DraftLine[] = lines
      .filter((l) => l.name.trim())
      .map((l) => ({
        name: l.name.trim(),
        quantity: Number.parseFloat(l.qtyText) || 1,
        unitPriceMinor: parseAmount(l.priceText) ?? 0,
        kind: l.kind,
        itemKey: l.itemKey,
        brand: l.brand,
        spec: l.spec,
      }));
    const keys = coveredKeys(clean, extraKeys);
    saveVisit(
      vehicle,
      {
        servicedAt,
        odometer: Number.isFinite(odo) ? odo : null,
        kind,
        title: (titleTyped && title.trim()) || suggestedTitle,
        costMinor: parseAmount(cost) ?? (clean.length > 0 && linesTotal > 0 ? Math.round(linesTotal) : null),
        note: note.trim() || null,
        imageUri,
        lines: clean,
        extraKeys: extraKeys.filter((k) => !clean.some((l) => l.itemKey === k)),
      },
      existing?.id,
    );
    refreshMiniAppData();
    closeModal();
  }

  function confirmDelete() {
    if (!vehicle || !existing) return;
    Alert.alert('Delete this visit?', 'Its bill and what it counted as done are removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeVisit(vehicle, existing.id);
          refreshMiniAppData();
          closeModal();
        },
      },
    ]);
  }

  const hasContent = (titleTyped && title.trim()) || lines.length > 0 || extraKeys.length > 0 || Boolean(imageUri);

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title={existing ? 'Edit visit' : 'Add a service visit'}
      eyebrow={vehicle.name}
      icon="construct"
      iconColor={colors.completed}
      scroll
      footer={
        <GradientButton
          label={existing ? 'Save changes' : 'Save visit'}
          icon="checkmark"
          onPress={save}
          disabled={!hasContent}
        />
      }
    >
      {/* The invoice first: one photo fills most of the form. */}
      <AiScanCard
        label="INVOICE OR JOB CARD"
        title="Scan the bill"
        hint="AI fills in the parts, prices, date and odometer. You check each line."
        value={imageUri}
        onChange={setImageUri}
        onRead={readPhoto}
        hasData={lines.length > 0}
        deleteOnReplace={!existing}
      />

      <View style={{ gap: space.md }}>
        <Label>THE VISIT</Label>
        <DatePickerField label="Date" value={servicedAt} onChange={setServicedAt} />
        <Field
          label={`Odometer reading (${unit})`}
          value={odometer}
          onChangeText={setOdometer}
          placeholder="e.g. 48200"
          keyboardType="numeric"
        />
        <PillSelect
          label="Kind"
          options={(Object.keys(SERVICE_KIND_LABEL) as ServiceKind[]).map((key) => ({
            key,
            label: SERVICE_KIND_LABEL[key],
          }))}
          selectedKey={kind}
          onSelect={(key) => setKind(key as ServiceKind)}
        />
        <Field
          label="Title"
          value={titleTyped ? title : suggestedTitle}
          onChangeText={(text) => {
            setTitle(text);
            setTitleTyped(text.trim().length > 0);
          }}
          placeholder={suggestedTitle}
        />
        {titleTyped ? (
          <Pressable
            onPress={() => {
              setTitle('');
              setTitleTyped(false);
            }}
            hitSlop={8}
          >
            <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              Use the automatic title: {suggestedTitle}
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="muted">
            Filled in from the visit — type to change it.
          </Text>
        )}
      </View>

      {/* The bill. Each line says what it counts as on the schedule. */}
      <View style={{ gap: space.sm }}>
        <Row justify="space-between" align="center">
          <Label>PARTS &amp; LABOUR</Label>
          {linesTotal > 0 ? (
            <Text variant="caption" tone="secondary">
              {formatMoney(Math.round(linesTotal))}
            </Text>
          ) : null}
        </Row>
        {aiLines > 0 ? (
          <Text variant="caption" tone="secondary">
            Lines marked with a sparkle were read by AI. The green chip is what each counts as —
            tap a line to change it.
          </Text>
        ) : null}

        {lines.length > 0 ? (
          <Surface padded={false}>
            {lines.map((line, index) => {
              const open = openLine === line.id;
              const parts = line.itemKey ? partFor(line.itemKey, vehicle.kind, vehicle.fuelType) : null;
              const part = describePart(line);
              const total = (Number.parseFloat(line.qtyText) || 1) * (parseAmount(line.priceText) ?? 0);
              const counts = line.itemKey ? titleOf(line.itemKey) : null;
              return (
                <View key={line.id}>
                  {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                  <Pressable
                    onPress={() => setOpenLine(open ? null : line.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    style={({ pressed }) => ({
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      gap: 6,
                      opacity: pressed ? 0.75 : 1,
                    })}
                  >
                    <Row align="center" style={{ gap: space.sm }}>
                      {line.fromAi ? <Ionicons name="sparkles" size={13} color={colors.accent} /> : null}
                      <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                        {line.name || 'New line'}
                      </Text>
                      <Text variant="small" tone="secondary">
                        {total > 0 ? formatMoney(Math.round(total)) : ''}
                      </Text>
                      <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.inkMuted}
                      />
                    </Row>
                    <Row align="center" style={{ gap: space.sm, flexWrap: 'wrap' }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          paddingHorizontal: space.sm,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: counts ? colors.completedSoft : colors.surfaceSunken,
                        }}
                      >
                        <Ionicons
                          name={counts ? 'checkmark-circle' : 'remove-circle-outline'}
                          size={12}
                          color={counts ? colors.completed : colors.inkMuted}
                        />
                        <Text
                          variant="caption"
                          color={counts ? colors.completed : colors.inkSecondary}
                          style={{ fontWeight: '700' }}
                        >
                          {counts ?? 'Not on the schedule'}
                        </Text>
                      </View>
                      {part ? (
                        <Text variant="caption" tone="secondary">
                          {part}
                        </Text>
                      ) : null}
                    </Row>
                  </Pressable>

                  {open ? (
                    <View
                      style={{
                        paddingHorizontal: space.lg,
                        paddingBottom: space.lg,
                        gap: space.md,
                      }}
                    >
                      <Field
                        label="Item"
                        value={line.name}
                        onChangeText={(text) => renameLine(line, text)}
                        placeholder="e.g. Oil filter"
                        autoFocus={!line.name}
                      />
                      <Row gap={space.sm}>
                        <Field
                          label="Qty"
                          value={line.qtyText}
                          onChangeText={(text) => patchLine(line.id, { qtyText: text })}
                          keyboardType="decimal-pad"
                          style={{ flex: 1 }}
                        />
                        <Field
                          label="Price each"
                          value={line.priceText}
                          onChangeText={(text) => patchLine(line.id, { priceText: text })}
                          placeholder="0"
                          money
                          style={{ flex: 2 }}
                        />
                      </Row>
                      <PillSelect
                        label="Type"
                        options={KIND_OPTIONS}
                        selectedKey={line.kind}
                        onSelect={(key) => patchLine(line.id, { kind: key as LineKind })}
                        singleRow
                      />
                      <PillSelect
                        label="Counts as"
                        options={[
                          { key: '', label: 'Not on the schedule' },
                          ...schedule.map((i) => ({ key: i.key, label: i.title })),
                        ]}
                        selectedKey={line.itemKey}
                        onSelect={(key) =>
                          patchLine(line.id, {
                            itemKey: key,
                            ...(key ? detectPart(key, vehicle.kind, vehicle.fuelType, line.name) : {}),
                          })
                        }
                      />
                      {parts ? (
                        <>
                          {parts.brands.length > 0 ? (
                            <View style={{ gap: space.sm }}>
                              <Field
                                label="Brand"
                                value={line.brand}
                                onChangeText={(text) => patchLine(line.id, { brand: text })}
                                placeholder="Tap one or type"
                              />
                              <SuggestionChips
                                options={parts.brands}
                                value={line.brand}
                                onChange={(text) => patchLine(line.id, { brand: text })}
                              />
                            </View>
                          ) : null}
                          <View style={{ gap: space.sm }}>
                            <Field
                              label={parts.specLabel}
                              value={line.spec}
                              onChangeText={(text) => patchLine(line.id, { spec: text })}
                              placeholder={parts.specPlaceholder}
                            />
                            <SuggestionChips
                              options={parts.specs}
                              value={line.spec}
                              onChange={(text) => patchLine(line.id, { spec: text })}
                            />
                          </View>
                        </>
                      ) : null}
                      <Row justify="space-between">
                        <Button
                          label="Remove line"
                          icon="trash-outline"
                          variant="ghost"
                          onPress={() => {
                            setLines((c) => c.filter((l) => l.id !== line.id));
                            setOpenLine(null);
                          }}
                        />
                        <Button label="Done" variant="secondary" onPress={() => setOpenLine(null)} />
                      </Row>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Surface>
        ) : null}
        <Button label="Add a line" icon="add" variant="secondary" onPress={addLine} />
      </View>

      {/* Work with no line of its own — a free tyre rotation, a checked brake. */}
      <View style={{ gap: space.sm }}>
        <Label>ALSO DONE ON THIS VISIT</Label>
        <Text variant="caption" tone="secondary">
          Tick anything that was done or checked without its own line on the bill. Green ones come
          from the lines above.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {schedule.map((item) => {
            const fromLine = lineKeys.has(item.key);
            const on = fromLine || extraKeys.includes(item.key);
            return (
              <Pressable
                key={item.key}
                onPress={() => toggleExtra(item.key)}
                disabled={fromLine}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: fromLine }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingVertical: 7,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? colors.completed : colors.hairline,
                  backgroundColor: on ? colors.completedSoft : colors.surface,
                }}
              >
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={14}
                  color={on ? colors.completed : colors.inkMuted}
                />
                <Text
                  variant="small"
                  color={on ? colors.completed : colors.inkSecondary}
                  style={{ fontWeight: on ? '700' : '500' }}
                >
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Label>COST</Label>
        <AmountField
          label="Total paid"
          value={cost}
          onChangeText={setCost}
          currency={currency}
          hero={false}
          placeholder={linesTotal > 0 ? String(Math.round(linesTotal) / 100) : '0'}
        />
        <Field
          label="Garage or note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Toyota agent, Wattala"
        />
      </View>

      {existing ? (
        <Button label="Delete this visit" icon="trash-outline" variant="danger" onPress={confirmDelete} />
      ) : null}
    </BottomSheet>
  );
}
