import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Button,
  Divider,
  Empty,
  GradientButton,
  Label,
  Row,
  Surface,
  Text,
} from '../../../src/components/ui';
import { Screen } from '../../../src/components/Screen';
import { AmountField, Field, PillSelect } from '../../../src/components/forms';
import { formatMoney, parseAmount } from '../../../src/core/money';
import { serviceItemRepo, vehicleServiceRepo } from '../../../src/db/repositories';
import { SERVICE_KIND_LABEL, type ServiceKind } from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * An icon and colour per kind of work.
 *
 * A service log is scanned for "when did I last do X" far more often than it is
 * read end to end, and a glyph is findable at a glance in a way a word in a grey
 * subtitle is not. The colours are semantic rather than decorative: repairs and
 * tyres are things that went wrong, insurance and licence are obligations.
 */
const SERVICE_VISUAL: Record<
  ServiceKind,
  { icon: keyof typeof Ionicons.glyphMap; tone: 'accent' | 'danger' | 'pending' | 'completed' }
> = {
  service: { icon: 'construct-outline', tone: 'completed' },
  repair: { icon: 'hammer-outline', tone: 'danger' },
  tyres: { icon: 'disc-outline', tone: 'accent' },
  insurance: { icon: 'shield-checkmark-outline', tone: 'pending' },
  licence: { icon: 'document-text-outline', tone: 'pending' },
  other: { icon: 'ellipsis-horizontal-outline', tone: 'accent' },
};

/** A line item being typed, before the parent service exists to attach it to. */
interface DraftItem {
  name: string;
  quantity: number;
  unitPriceMinor: number;
}

/** History of services and repairs for one vehicle, newest first. */
export default function ServicesScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const state = useAppStore();
  const { vehicle: vehicleId } = useLocalSearchParams<{ vehicle?: string }>();

  const vehicle = useMemo(
    () => state.vehicles.find((v) => v.id === vehicleId) ?? state.vehicles[0],
    [state.vehicles, vehicleId],
  );

  const services = useMemo(
    () => (vehicle ? vehicleServiceRepo.byVehicle(vehicle.id) : []),
    [vehicle, state.vehicles],
  );

  /** Items for every service on screen — one query, not one per row. */
  const itemsByService = useMemo(
    () => serviceItemRepo.byServices(services.map((s) => s.id)),
    [services],
  );

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ServiceKind>('service');
  const [odometer, setOdometer] = useState('');
  const [cost, setCost] = useState('');
  const [nextDue, setNextDue] = useState('');

  /**
   * Line items being typed, before the record is saved.
   *
   * Held here rather than written per-keystroke because a service has no id
   * until it is created — and half a bill in the database, abandoned when the
   * user backs out, is worse than none.
   */
  const [items, setItems] = useState<DraftItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemPrice, setItemPrice] = useState('');

  /** Which history cards are expanded to show their parts. */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const unit = vehicle?.odometerUnit ?? 'km';
  const draftTotal = items.reduce((sum, i) => sum + i.quantity * i.unitPriceMinor, 0);

  function addItem() {
    if (!itemName.trim()) return;
    setItems((current) => [
      ...current,
      {
        name: itemName.trim(),
        quantity: Number.parseFloat(itemQty) || 1,
        unitPriceMinor: parseAmount(itemPrice) ?? 0,
      },
    ]);
    setItemName('');
    setItemQty('1');
    setItemPrice('');
  }

  function handleSave() {
    if (!vehicle || !title.trim()) return;
    const odo = Number.parseFloat(odometer.replace(/,/g, ''));
    const due = Number.parseFloat(nextDue.replace(/,/g, ''));

    const created = vehicleServiceRepo.create({
      vehicleId: vehicle.id,
      servicedAt: new Date(),
      odometer: Number.isFinite(odo) ? odo : null,
      kind,
      title: title.trim(),
      // The typed total wins when given; otherwise the items add up to it, so an
      // itemised bill needs the figure entered only once.
      costMinor: parseAmount(cost) ?? (items.length > 0 ? draftTotal : null),
      nextDueOdometer: Number.isFinite(due) ? due : null,
    });

    items.forEach((item, index) =>
      serviceItemRepo.create({ ...item, serviceId: created.id, sortOrder: index }),
    );

    state.refresh();
    setTitle('');
    setOdometer('');
    setCost('');
    setNextDue('');
    setItems([]);
    setAdding(false);
  }

  return (
    <Screen
      title="Service log"
      onBack={() => router.back()}
      footer={
        adding ? (
          <GradientButton
            label="Save record"
            icon="checkmark"
            onPress={handleSave}
            disabled={!title.trim()}
          />
        ) : (
          <GradientButton label="Add a record" icon="add" onPress={() => setAdding(true)} />
        )
      }
    >
      {adding ? (
        <View style={{ gap: space.lg }}>
          <Label>NEW RECORD</Label>
          <Field
            label="What was done"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Oil change"
            autoFocus
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
            label={`Odometer (${unit})`}
            value={odometer}
            onChangeText={setOdometer}
            placeholder="e.g. 10200"
            keyboardType="numeric"
          />
          <AmountField
            label="Total cost"
            value={cost}
            onChangeText={setCost}
            currency={state.currency}
            hero={false}
          />
          <Field
            label={`Next due at (${unit}, optional)`}
            value={nextDue}
            onChangeText={setNextDue}
            placeholder="e.g. 15000"
            keyboardType="numeric"
          />

          {/*
            The bill, line by line.

            A garage invoice is a list — "oil filter 2,400, 5W-30 x4 9,600,
            labour 6,500" — and the reason to keep a service record at all is to
            know WHICH parts were changed and how long ago. A single total
            answers what was spent and nothing else.
          */}
          <View style={{ gap: space.sm }}>
            <Row justify="space-between" align="center">
              <Label>PARTS &amp; LABOUR</Label>
              {items.length > 0 ? (
                <Text variant="caption" tone="secondary">
                  {formatMoney(draftTotal)}
                </Text>
              ) : null}
            </Row>

            {items.length > 0 ? (
              <Surface padded={false}>
                {items.map((item, index) => (
                  <View key={`${item.name}-${index}`}>
                    {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                    <Row
                      align="center"
                      style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text variant="small">{item.name}</Text>
                        {item.quantity !== 1 ? (
                          <Text variant="caption" tone="muted">
                            {item.quantity} × {formatMoney(item.unitPriceMinor)}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="small" tone="secondary">
                        {formatMoney(item.quantity * item.unitPriceMinor)}
                      </Text>
                      <Pressable
                        onPress={() => setItems((c) => c.filter((_, i) => i !== index))}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        hitSlop={10}
                        style={{ marginLeft: space.md }}
                      >
                        <Ionicons name="close-circle" size={17} color={colors.inkMuted} />
                      </Pressable>
                    </Row>
                  </View>
                ))}
              </Surface>
            ) : null}

            {/* Name, quantity and price on one line — adding a part should not
                cost three separate trips into a form. */}
            <Row gap={space.sm} align="flex-end">
              <Field
                label="Item"
                value={itemName}
                onChangeText={setItemName}
                placeholder="e.g. Oil filter"
                style={{ flex: 2 }}
              />
              <Field
                label="Qty"
                value={itemQty}
                onChangeText={setItemQty}
                placeholder="1"
                keyboardType="decimal-pad"
                style={{ flex: 1 }}
              />
              <Field
                label="Price"
                value={itemPrice}
                onChangeText={setItemPrice}
                placeholder="0"
                keyboardType="numeric"
                style={{ flex: 1.4 }}
              />
            </Row>
            <Button
              label="Add item"
              icon="add"
              variant="secondary"
              onPress={addItem}
              disabled={!itemName.trim()}
            />
          </View>
        </View>
      ) : null}

      {services.length === 0 && !adding ? (
        <Empty
          icon="build-outline"
          title="Nothing logged yet"
          message="Record a service to keep track of what was done, which parts went in, and when the next one falls due."
        />
      ) : null}

      {services.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>HISTORY</Label>

          {/* A card each: every service is a separate event with its own date,
              odometer and bill, and stacking them inside one surface made the
              log read as a single ledger rather than as distinct visits. */}
          {services.map((record) => {
            const lines = itemsByService.get(record.id) ?? [];
            const open = openIds.has(record.id);
            const visual = SERVICE_VISUAL[record.kind];
            const accent = colors[visual.tone];
            const itemsTotal = lines.reduce((t, l) => t + l.quantity * l.unitPriceMinor, 0);

            return (
              <Surface key={record.id} padded={false}>
                {/* The card expands rather than pushing a screen: the parts are
                    a handful of lines, and a whole navigation step to read four
                    of them is more friction than the content deserves. */}
                <Pressable
                  onPress={() =>
                    setOpenIds((current) => {
                      const next = new Set(current);
                      if (next.has(record.id)) next.delete(record.id);
                      else next.add(record.id);
                      return next;
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${record.title}, ${lines.length} items`}
                  disabled={lines.length === 0}
                  style={({ pressed }) => ({
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Row gap={space.md} align="center">
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: `${accent}1A`,
                      }}
                    >
                      <Ionicons name={visual.icon} size={18} color={accent} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {record.title}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {[
                          record.servicedAt.toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          }),
                          record.odometer
                            ? `${Math.round(record.odometer).toLocaleString()} ${unit}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="figure">
                        {record.costMinor ? formatMoney(record.costMinor, { compact: true }) : '—'}
                      </Text>
                      {lines.length > 0 ? (
                        <Row gap={3} align="center">
                          <Text variant="caption" tone="muted">
                            {lines.length} item{lines.length === 1 ? '' : 's'}
                          </Text>
                          <Ionicons
                            name={open ? 'chevron-up' : 'chevron-down'}
                            size={12}
                            color={colors.inkMuted}
                          />
                        </Row>
                      ) : null}
                    </View>
                  </Row>
                </Pressable>

                {open && lines.length > 0 ? (
                  <View>
                    <Divider style={{ marginHorizontal: space.lg }} />
                    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 8 }}>
                      {lines.map((line) => (
                        <Row key={line.id} justify="space-between" align="center">
                          <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                            {line.quantity !== 1 ? `${line.quantity} × ` : ''}
                            {line.name}
                          </Text>
                          <Text variant="small">
                            {formatMoney(line.quantity * line.unitPriceMinor)}
                          </Text>
                        </Row>
                      ))}

                      {/*
                        Said out loud when the parts do not sum to the invoice.

                        A real bill carries tax and discounts the lines never add
                        up to, so the two disagreeing is normal — but silently
                        showing two different numbers on one card is not.
                      */}
                      {record.costMinor && itemsTotal !== record.costMinor ? (
                        <>
                          <Divider />
                          <Row justify="space-between">
                            <Text variant="caption" tone="muted">
                              Items total
                            </Text>
                            <Text variant="caption" tone="muted">
                              {formatMoney(itemsTotal)}
                            </Text>
                          </Row>
                        </>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </Surface>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
