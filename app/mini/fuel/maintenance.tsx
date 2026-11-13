import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  Button,
  Divider,
  Empty,
  GradientButton,
  Label,
  Row,
  Segmented,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import { Field, PillSelect } from '~/shared/components/forms';
import {
  describeDue,
  describeRate,
  serviceMilestones,
  spanText,
  type ServiceMilestone,
  type MaintenanceItemStatus,
  type MaintenanceStatus,
} from '~/features/fuel/logic/maintenance';
import { GROUP_ICON } from '~/features/fuel/components/maintenanceVisual';
import {
  lastRegularService,
  vehicleItems,
  vehicleMaintenancePlan,
} from '~/features/fuel/services/maintenanceReminders';
import { maintenanceHistory, type HistoryEntry } from '~/features/fuel/logic/serviceVisit';
import {
  maintenanceMarkRepo,
  maintenanceOverrideRepo,
  serviceItemRepo,
  vehicleServiceRepo,
} from '~/db/repositories';
import { describeModel } from '~/features/fuel/logic/modelSchedule';
import { lastItemCosts, removeVisit } from '~/features/fuel/services/serviceVisits';
import type { ServiceKind, VehicleCondition } from '~/db/schema';
import { formatMoney } from '~/shared/lib/money';
import { useAppActions, useAppSelector } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

const SECTIONS: { status: MaintenanceStatus; label: string }[] = [
  { status: 'overdue', label: 'OVERDUE' },
  { status: 'soon', label: 'DUE SOON' },
  { status: 'ok', label: 'UPCOMING' },
  { status: 'unknown', label: 'NO RECORD YET' },
  { status: 'not_applicable', label: 'NOT APPLICABLE' },
];

/**
 * Everything a vehicle needs replaced, inspected or serviced — and when.
 *
 * Built from the schedule in features/fuel/logic/maintenance.ts against this
 * vehicle's odometer, its service log and the marks made here. Most urgent
 * first, because the question this screen answers is "what do I need to do".
 */
export default function MaintenanceScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const vehicles = useAppSelector((s) => s.vehicles);
  const { updateVehicle, removeMaintenanceMark, refreshMiniAppData } = useAppActions();
  const { vehicle: vehicleId, tab: tabParam } = useLocalSearchParams<{ vehicle?: string; tab?: string }>();
  const [tab, setTab] = useState<'due' | 'history'>(tabParam === 'history' ? 'history' : 'due');

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];
  // `vehicles` changes on every write here (refreshMiniAppData), which re-runs this.
  const plan = useMemo(() => (vehicle ? vehicleMaintenancePlan(vehicle) : null), [vehicle, vehicles]);
  const unit = vehicle?.odometerUnit ?? 'km';
  const milestones = useMemo(
    () =>
      plan && vehicle
        ? serviceMilestones(plan, vehicle.kind, 3, {
            lastCosts: lastItemCosts(vehicle),
            service: vehicle.serviceIntervalKm
              ? {
                  km: vehicle.serviceIntervalKm,
                  months: vehicle.serviceIntervalMonths,
                  last: lastRegularService(vehicle),
                }
              : null,
          })
        : [],
    [plan, vehicle],
  );
  const tailored = useMemo(
    () => (vehicle ? maintenanceOverrideRepo.byVehicle(vehicle.id).length : 0),
    [vehicle, vehicles],
  );
  const modelName = vehicle ? describeModel(vehicle) : null;
  const history = useMemo(() => {
    if (!vehicle) return [];
    const services = vehicleServiceRepo.byVehicle(vehicle.id);
    const lines = serviceItemRepo.byServices(services.map((s) => s.id));
    return maintenanceHistory({
      kind: vehicle.kind,
      fuelType: vehicle.fuelType,
      services: services.map((s) => ({
        ...s,
        lines: (lines.get(s.id) ?? []).map((l) => ({ name: l.name, itemKey: l.itemKey ?? null })),
      })),
      marks: maintenanceMarkRepo.byVehicle(vehicle.id),
      items: vehicleItems(vehicle),
    });
  }, [vehicle, vehicles]);

  const [showNa, setShowNa] = useState(false);
  const [condition, setCondition] = useState<VehicleCondition | null>(null);
  const [boughtAt, setBoughtAt] = useState('');

  if (!vehicle || !plan) {
    return (
      <Screen title="Maintenance" onBack={() => router.back()}>
        <Text tone="muted">Add a vehicle first.</Text>
      </Screen>
    );
  }

  function saveCondition() {
    if (!vehicle || !condition) return;
    const odo = Number.parseFloat(boughtAt.replace(/,/g, ''));
    updateVehicle(vehicle.id, {
      condition,
      acquiredOdometer: Number.isFinite(odo) ? odo : condition === 'new' ? 0 : null,
      acquiredAt: vehicle.acquiredAt ?? vehicle.createdAt,
    });
  }

  const tone = (status: MaintenanceStatus) =>
    status === 'overdue'
      ? colors.danger
      : status === 'soon'
        ? colors.pending
        : status === 'ok'
          ? colors.completed
          : colors.inkMuted;

  const addVisit = () => router.push(`/mini/fuel/service-visit?vehicle=${vehicle.id}`);

  return (
    <Screen
      title="Maintenance"
      onBack={() => router.back()}
      footer={<GradientButton label="Add a service visit" icon="add" onPress={addVisit} />}
    >
      <Segmented
        options={[
          { key: 'due', label: "What's due", icon: 'alarm-outline' },
          { key: 'history', label: 'History', icon: 'time-outline' },
        ]}
        selectedKey={tab}
        onSelect={(key) => setTab(key as 'due' | 'history')}
      />

      {tab === 'history' ? (
        <HistoryTab
          entries={history}
          unit={unit}
          onOpenVisit={(id) => router.push(`/mini/fuel/service-visit?vehicle=${vehicle.id}&id=${id}`)}
          onOpenItem={(key) => router.push(`/mini/fuel/maintenance-item?vehicle=${vehicle.id}&key=${key}`)}
          onDelete={(entry) => {
            if (entry.type === 'mark') {
              removeMaintenanceMark(entry.id);
            } else {
              removeVisit(vehicle, entry.id);
              refreshMiniAppData();
            }
          }}
        />
      ) : (
      <>
      {/*
        New or used is asked here, not assumed, for vehicles added before the
        question existed. It decides whether a missing record means "not done
        yet" (new) or "unknown" (used) — the difference between an honest
        schedule and one that hides a ten-year-old timing belt.
      */}
      {vehicle.condition == null ? (
        <Surface style={{ gap: space.md }}>
          <View style={{ gap: 4 }}>
            <Text variant="bodyStrong">Did you get {vehicle.name} new or used?</Text>
            <Text variant="caption" tone="muted">
              A new vehicle counts every item from delivery. A used one starts with &quot;no
              record&quot; until you mark what has been done.
            </Text>
          </View>
          <PillSelect
            singleRow
            options={[
              { key: 'new', label: 'Brand new' },
              { key: 'used', label: 'Used' },
            ]}
            selectedKey={condition}
            onSelect={(key) => setCondition(key as VehicleCondition)}
          />
          {condition ? (
            <Field
              label={`Odometer when you got it (${unit}, optional)`}
              value={boughtAt}
              onChangeText={setBoughtAt}
              placeholder={condition === 'new' ? 'e.g. 12' : 'e.g. 64000'}
              keyboardType="numeric"
            />
          ) : null}
          <Button label="Save" icon="checkmark" onPress={saveCondition} disabled={!condition} />
        </Surface>
      ) : null}

      {/* The headline: how many things need doing, in the colours they carry below. */}
      <Surface style={{ gap: space.md }}>
        <Row justify="space-between">
          <Count label="OVERDUE" value={plan.counts.overdue} color={colors.danger} />
          <Count label="DUE SOON" value={plan.counts.soon} color={colors.pending} />
          <Count label="ON TRACK" value={plan.counts.ok} color={colors.completed} />
          <Count label="NO RECORD" value={plan.counts.unknown} color={colors.inkMuted} />
        </Row>
        <Divider />
        <Text variant="caption" tone="muted">
          {[
            plan.currentOdometer != null
              ? `Odometer ${Math.round(plan.currentOdometer).toLocaleString()} ${unit}`
              : 'Log a fill-up to set the odometer',
            plan.dailyDistance != null
              ? `about ${Math.round(plan.dailyDistance)} ${unit} a day`
              : null,
            vehicle.condition ? (vehicle.condition === 'new' ? 'bought new' : 'bought used') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Surface>

      {/* Tailored to the exact model, or an invitation to. */}
      <Pressable
        onPress={() => router.push(`/mini/fuel/model-schedule?vehicle=${vehicle.id}`)}
        accessibilityRole="button"
        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      >
        <Surface>
          <Row align="center" style={{ gap: space.md }}>
            <Ionicons name="sparkles" size={18} color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">
                {tailored > 0 ? `Matched to ${modelName ?? 'your model'}` : 'Match your exact model'}
              </Text>
              <Text variant="caption" tone="secondary">
                {tailored > 0
                  ? `${tailored} item${tailored === 1 ? '' : 's'} tailored · tap to look again or reset`
                  : modelName
                    ? `Use the ${modelName} manual's intervals and specs`
                    : 'Add make, model and year to get your manual\'s intervals and specs'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
          </Row>
        </Surface>
      </Pressable>

      {milestones.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>NEXT SERVICES</Label>
          <Text variant="caption" tone="secondary">
            {plan.rate
              ? `What to get done at each reading, and roughly when — you drive ${describeRate(plan.rate, unit)} (since ${plan.rate.since.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}).`
              : 'What to get done at each reading. Log fill-ups for two weeks or more and Dayly estimates when you will get there.'}
          </Text>
          <Pressable onPress={() => router.push(`/mini/fuel/vehicle-edit?vehicle=${vehicle.id}`)} hitSlop={6}>
            <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {vehicle.serviceIntervalKm
                ? `Serviced every ${Math.round(vehicle.serviceIntervalKm).toLocaleString()} ${unit}${vehicle.serviceIntervalMonths ? ` or ${vehicle.serviceIntervalMonths} months` : ''} · Change`
                : 'Set how often this vehicle is serviced'}
            </Text>
          </Pressable>
          {milestones.map((m) => (
            <MilestoneCard
              key={m.atOdometer ?? 'now'}
              milestone={m}
              unit={unit}
              onOpen={(key) =>
                router.push(`/mini/fuel/maintenance-item?vehicle=${vehicle.id}&key=${key}`)
              }
            />
          ))}
        </View>
      ) : null}

      {SECTIONS.map(({ status, label }) => {
        const rows = plan.items.filter((e) => e.status === status);
        if (rows.length === 0) return null;
        const collapsed = status === 'not_applicable' && !showNa;

        return (
          <View key={status} style={{ gap: space.sm }}>
            <Row justify="space-between" align="center">
              <Label>{label}</Label>
              {status === 'not_applicable' ? (
                <Pressable onPress={() => setShowNa((v) => !v)} hitSlop={10}>
                  <Text variant="caption" tone="secondary">
                    {showNa ? 'Hide' : `Show ${rows.length}`}
                  </Text>
                </Pressable>
              ) : null}
            </Row>
            {status === 'unknown' ? (
              <Text variant="caption" tone="muted">
                Nothing on record since you got it. Have these checked at your next service,
                then mark them done so the schedule can count from there.
              </Text>
            ) : null}
            {collapsed ? null : (
              <Surface padded={false}>
                {rows.map((entry, index) => (
                  <View key={entry.item.key}>
                    {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                    <ItemRow
                      entry={entry}
                      unit={unit}
                      color={tone(entry.status)}
                      onPress={() =>
                        router.push(
                          `/mini/fuel/maintenance-item?vehicle=${vehicle.id}&key=${entry.item.key}`,
                        )
                      }
                    />
                  </View>
                ))}
              </Surface>
            )}
          </View>
        );
      })}

      <Text variant="caption" tone="muted">
        Intervals follow manufacturers&apos; severe-use schedules — heat, dust and stop-and-go
        traffic — which is normal driving here. Your owner&apos;s manual wins for your exact model.
        Every service visit you add ticks off what it covered.
      </Text>
      </>
      )}
    </Screen>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ gap: 2, alignItems: 'center', flex: 1 }}>
      <Text variant="figure" color={value > 0 ? color : undefined} tone={value > 0 ? undefined : 'muted'}>
        {value}
      </Text>
      <Label>{label}</Label>
    </View>
  );
}

function ItemRow({
  entry,
  unit,
  color,
  onPress,
}: {
  entry: MaintenanceItemStatus;
  unit: string;
  color: string;
  onPress: () => void;
}) {
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.item.title}, ${describeDue(entry, unit)}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${color}1A`,
        }}
      >
        <Ionicons name={GROUP_ICON[entry.item.group]} size={17} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>
          {entry.item.title}
        </Text>
        <Text
          variant="caption"
          color={entry.status === 'overdue' || entry.status === 'soon' ? color : undefined}
          tone={entry.status === 'overdue' || entry.status === 'soon' ? undefined : 'muted'}
          numberOfLines={1}
        >
          {describeDue(entry, unit)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
    </Pressable>
  );
}

const VISIT_ICON: Record<ServiceKind, keyof typeof Ionicons.glyphMap> = {
  service: 'construct-outline',
  repair: 'hammer-outline',
  tyres: 'disc-outline',
  insurance: 'shield-checkmark-outline',
  licence: 'document-text-outline',
  other: 'ellipsis-horizontal-outline',
};

/**
 * Everything that has been done, newest first: garage visits with what they
 * covered, and items marked done on their own. Grouped by year, because "when
 * did I last…" is answered by scanning dates.
 */
function HistoryTab({
  entries,
  unit,
  onOpenVisit,
  onOpenItem,
  onDelete,
}: {
  entries: HistoryEntry[];
  unit: string;
  onOpenVisit: (id: string) => void;
  onOpenItem: (key: string) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  function confirmDelete(entry: HistoryEntry) {
    const name = entry.type === 'visit' ? entry.title : entry.item.title;
    Alert.alert(
      entry.type === 'visit' ? 'Delete this visit?' : 'Delete this record?',
      entry.type === 'visit'
        ? `"${name}" — its bill and everything it ticked off the schedule are removed.`
        : `"${name}" — the schedule counts from the record before it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(entry) },
      ],
    );
  }

  const { colors, space } = useTheme();

  if (entries.length === 0) {
    return (
      <Empty
        icon="construct-outline"
        title="Nothing recorded yet"
        message="Add your next garage visit — snap the invoice and Dayly fills in the parts and ticks off the schedule."
      />
    );
  }

  const thisYear = new Date().getFullYear();
  const spentThisYear = entries.reduce(
    (sum, e) => sum + (e.type === 'visit' && e.at.getFullYear() === thisYear ? (e.costMinor ?? 0) : 0),
    0,
  );
  const visitsThisYear = entries.filter((e) => e.type === 'visit' && e.at.getFullYear() === thisYear).length;

  const years = new Map<number, HistoryEntry[]>();
  for (const entry of entries) {
    const y = entry.at.getFullYear();
    years.set(y, [...(years.get(y) ?? []), entry]);
  }

  return (
    <>
      <Surface>
        <Row justify="space-between">
          <View style={{ gap: 2 }}>
            <Label>SPENT IN {thisYear}</Label>
            <Text variant="figureLarge">{spentThisYear > 0 ? formatMoney(spentThisYear) : 'Not set'}</Text>
          </View>
          <View style={{ gap: 2, alignItems: 'flex-end' }}>
            <Label>VISITS</Label>
            <Text variant="figureLarge">{visitsThisYear}</Text>
          </View>
        </Row>
      </Surface>

      <Text variant="caption" tone="muted">
        Tap a record to open or edit it. Press and hold to delete it.
      </Text>

      {[...years.entries()].map(([year, list]) => (
        <View key={year} style={{ gap: space.sm }}>
          <Label>{String(year)}</Label>
          <Surface padded={false}>
            {list.map((entry, index) => (
              <View key={`${entry.type}-${entry.id}`}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <Pressable
                  onPress={() =>
                    entry.type === 'visit' ? onOpenVisit(entry.id) : onOpenItem(entry.item.key)
                  }
                  onLongPress={() => confirmDelete(entry)}
                  accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === 'delete') confirmDelete(entry);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 11,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${colors.completed}1A`,
                    }}
                  >
                    <Ionicons
                      name={entry.type === 'visit' ? VISIT_ICON[entry.kind] : GROUP_ICON[entry.item.group]}
                      size={17}
                      color={colors.completed}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Row justify="space-between" align="center" style={{ gap: space.sm }}>
                      <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                        {entry.type === 'visit' ? entry.title : entry.item.title}
                      </Text>
                      {entry.type === 'visit' && entry.costMinor ? (
                        <Text variant="figure">{formatMoney(entry.costMinor, { compact: true })}</Text>
                      ) : null}
                    </Row>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {[
                        entry.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
                        entry.odometer != null
                          ? `${Math.round(entry.odometer).toLocaleString()} ${unit}`
                          : null,
                        entry.type === 'visit' && entry.hasInvoice ? 'invoice' : null,
                        entry.type === 'mark' ? (entry.part ?? 'marked done') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {entry.type === 'visit' && entry.covered.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {entry.covered.map((item) => (
                          <View
                            key={item.key}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 3,
                              paddingHorizontal: 7,
                              paddingVertical: 2,
                              borderRadius: 999,
                              backgroundColor: colors.completedSoft,
                            }}
                          >
                            <Ionicons name="checkmark" size={10} color={colors.completed} />
                            <Text variant="caption" color={colors.completed} style={{ fontWeight: '700' }}>
                              {item.title}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : entry.type === 'visit' ? (
                      <Text variant="caption" tone="secondary">
                        Tap to choose what this visit covered
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            ))}
          </Surface>
        </View>
      ))}
    </>
  );
}

/** One planned garage visit: when, and the jobs on the list. */
function MilestoneCard({
  milestone,
  unit,
  onOpen,
}: {
  milestone: ServiceMilestone;
  unit: string;
  onOpen: (key: string) => void;
}) {
  const { colors, space } = useTheme();
  const now = milestone.atOdometer == null;
  const accent = now
    ? milestone.items.some((i) => i.status === 'overdue')
      ? colors.danger
      : colors.pending
    : colors.accent;
  return (
    <Surface padded={false}>
      <Row
        justify="space-between"
        align="center"
        style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}
      >
        <Row align="center" style={{ gap: space.sm }}>
          <Ionicons name={now ? 'alert-circle' : 'flag-outline'} size={17} color={accent} />
          <Text variant="bodyStrong" color={now ? accent : undefined}>
            {now
              ? 'Due now'
              : milestone.type === 'service' && milestone.atOdometer != null
                ? `${Math.round(milestone.atOdometer).toLocaleString()} ${unit} service`
                : milestone.byDate && milestone.expectedDate
                ? `By ${milestone.expectedDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                : milestone.atOdometer != null
                  ? `At ${Math.round(milestone.atOdometer).toLocaleString()} ${unit}`
                  : 'Later'}
          </Text>
        </Row>
        {milestone.daysAway != null && milestone.expectedDate ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="small" style={{ fontWeight: '700' }}>
              {milestone.daysAway <= 3 ? 'in a few days' : `in ~${spanText(milestone.daysAway)}`}
            </Text>
            {milestone.byDate ? null : (
              <Text variant="caption" tone="muted">
                about {milestone.expectedDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
              </Text>
            )}
          </View>
        ) : null}
      </Row>
      {!now && (milestone.kmAway != null || milestone.byDate) ? (
        <Text
          variant="caption"
          tone="secondary"
          style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}
        >
          {milestone.type === 'service'
            ? [
                milestone.kmAway != null ? `${Math.round(milestone.kmAway).toLocaleString()} ${unit} to go` : null,
                milestone.byDate && milestone.expectedDate
                  ? `or by ${milestone.expectedDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, whichever is first`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : milestone.byDate
            ? [
                milestone.atOdometer != null
                  ? `Around ${Math.round(milestone.atOdometer).toLocaleString()} ${unit} by then`
                  : null,
                'the time limit comes before the distance',
              ]
                .filter(Boolean)
                .join(' — ')
            : milestone.kmAway != null
              ? `${Math.round(milestone.kmAway).toLocaleString()} ${unit} to go`
              : ''}
        </Text>
      ) : null}
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: 6 }}>
        {milestone.items.map((entry) => (
          <Pressable key={entry.item.key} onPress={() => onOpen(entry.item.key)} hitSlop={4}>
            <Row align="center" style={{ gap: space.sm }}>
              <Ionicons name={GROUP_ICON[entry.item.group]} size={14} color={colors.inkSecondary} />
              <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>
                {entry.item.action === 'inspect' ? 'Check: ' : ''}
                {entry.item.title}
              </Text>
              {entry.item.recommended ? (
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ maxWidth: 120 }}>
                  {entry.item.recommended}
                </Text>
              ) : null}
            </Row>
          </Pressable>
        ))}
      </View>
      {milestone.estimateMinor != null ? (
        <>
          <Divider style={{ marginHorizontal: space.lg }} />
          <Row
            justify="space-between"
            align="center"
            style={{ paddingHorizontal: space.lg, paddingVertical: space.sm + 2 }}
          >
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              Parts last time
              {milestone.pricedItems < milestone.items.length
                ? ` (${milestone.pricedItems} of ${milestone.items.length})`
                : ''}
              , before labour
            </Text>
            <Text variant="figure">about {formatMoney(milestone.estimateMinor, { compact: true })}</Text>
          </Row>
        </>
      ) : null}
    </Surface>
  );
}
