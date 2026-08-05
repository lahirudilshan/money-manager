import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Divider, Empty, GradientButton, Label, Row, Surface, Text } from '../../../src/components/ui';
import { Screen } from '../../../src/components/Screen';
import { fuelStats, litresPer100, tankWindows, type FuelFill } from '../../../src/core/fuel';
import { formatMoney } from '../../../src/core/money';
import { fuelEntryRepo, vehicleServiceRepo } from '../../../src/db/repositories';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * The fuel mini app's home: one vehicle at a time, with its real numbers.
 *
 * Scoped to a single vehicle throughout, because every figure here is
 * meaningless otherwise — a car at 22 km/l and a motorbike at 45 averaged
 * together produce a number describing neither (see core/fuel.ts).
 */
export default function FuelHome() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const state = useAppStore();

  const vehicles = state.vehicles;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const vehicle = vehicles.find((v) => v.id === selectedId) ?? vehicles[0];

  /*
   * Read straight from the repositories rather than through the store.
   *
   * Fill-ups are mini-app data: holding them in the global store would load
   * them on every launch for the majority who never enable this. `state.vehicles`
   * changes whenever anything here is written, which is what re-runs the memo.
   */
  const fills = useMemo<FuelFill[]>(() => {
    if (!vehicle) return [];
    return fuelEntryRepo.byVehicle(vehicle.id).map((row) => ({
      id: row.id,
      odometer: row.odometer,
      litres: row.litres,
      isFullTank: row.isFullTank,
      missedPrevious: row.missedPrevious,
      filledAt: row.filledAt,
      totalMinor: row.totalMinor,
    }));
  }, [vehicle, state.vehicles]);

  const services = useMemo(
    () => (vehicle ? vehicleServiceRepo.byVehicle(vehicle.id) : []),
    [vehicle, state.vehicles],
  );

  const stats = useMemo(() => fuelStats(fills), [fills]);
  const windows = useMemo(() => tankWindows(fills), [fills]);
  const unit = vehicle?.odometerUnit ?? 'km';

  const num = (value: number | null, digits = 1) => (value === null ? '—' : value.toFixed(digits));

  /** How far the latest tank sits from this vehicle's own average. */
  const vsAverage =
    stats.latestEfficiency !== null && stats.averageEfficiency !== null
      ? stats.latestEfficiency - stats.averageEfficiency
      : null;

  /**
   * Columns for the trend chart — at most the last eight tanks, oldest first.
   *
   * Heights are scaled between the worst and best tank rather than from zero:
   * one vehicle's tanks all sit within a few km/L of each other, so a zero-based
   * axis draws eight near-identical bars and hides the very variation the chart
   * is for. The axis is labelled underneath so the non-zero baseline is stated
   * rather than implied.
   */
  const chart = useMemo(() => {
    const recent = windows.slice(-8);
    if (recent.length === 0) return [];

    const values = recent.map((w) => w.efficiency);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat history would divide by zero; render it as a level mid-height row.
    const span = max - min || 1;

    return recent.map((w, index) => ({
      id: w.id,
      efficiency: w.efficiency,
      // 18% floor so the worst tank is still a visible column rather than a line.
      heightPct: max === min ? 60 : 18 + ((w.efficiency - min) / span) * 82,
      label: w.to.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      isLatest: index === recent.length - 1,
    }));
  }, [windows]);

  if (vehicles.length === 0) {
    return (
      <Screen title="Fuel & vehicles" onBack={() => router.back()}>
        <Empty
          icon="car-sport-outline"
          title="No vehicles yet"
          message="Add a vehicle, then log a fill-up each time you visit the pump. Real consumption appears after the second full tank."
          actionLabel="Add a vehicle"
          onAction={() => router.push('/mini/fuel/vehicle')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={vehicle?.name ?? 'Fuel & vehicles'}
      onBack={() => router.back()}
      footer={
        <GradientButton
          label="Log a fill-up"
          icon="add"
          onPress={() => router.push(`/mini/fuel/entry?vehicle=${vehicle?.id}`)}
        />
      }
    >
      {/* Vehicle switcher — only when there is a choice to make. */}
      {vehicles.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
        >
          {vehicles.map((v) => {
            const active = v.id === vehicle?.id;
            return (
              <Pressable
                key={v.id}
                onPress={() => setSelectedId(v.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 8,
                  paddingHorizontal: space.md,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: active ? v.color : colors.hairline,
                  backgroundColor: active ? `${v.color}14` : colors.surface,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                {v.imageUri ? (
                  <Image source={{ uri: v.imageUri }} style={{ width: 18, height: 18, borderRadius: 5 }} />
                ) : (
                  <Ionicons name={(v.icon as never) ?? 'car-outline'} size={15} color={v.color} />
                )}
                <Text variant="small" style={{ fontWeight: active ? '700' : '500' }}>
                  {v.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/*
        The headline: what this tank actually did.

        Tank-to-tank leads because it is the only honest per-fill figure. The
        average sits beside it because one tank alone says little — a week of
        motorway driving flatters any vehicle.
      */}
      <Surface style={{ gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Label>LATEST TANK</Label>
          <Row gap={space.sm} align="baseline">
            <Text variant="hero" color={vehicle?.color ?? colors.ink}>
              {num(stats.latestEfficiency)}
            </Text>
            <Text variant="body" tone="muted">
              {unit}/L
            </Text>
          </Row>
          {/*
            How this tank compares to the vehicle's own average.

            A bare "12.4 km/L" is only meaningful to someone who already knows
            what this car normally does — which is precisely what a new user
            does not. Saying "0.3 better than usual" turns the figure into a
            verdict, and it is the vehicle's OWN average rather than any
            published number, so it stays true for how this car is actually
            driven.
          */}
          {stats.windowCount === 0 ? (
            <Text variant="caption" tone="muted">
              Log a second full tank to measure consumption
            </Text>
          ) : (
            <Row gap={6} align="center">
              {vsAverage !== null && Math.abs(vsAverage) >= 0.05 ? (
                <>
                  <Ionicons
                    name={vsAverage > 0 ? 'trending-up' : 'trending-down'}
                    size={13}
                    color={vsAverage > 0 ? colors.completed : colors.danger}
                  />
                  <Text
                    variant="caption"
                    color={vsAverage > 0 ? colors.completed : colors.danger}
                    style={{ fontWeight: '700' }}
                  >
                    {Math.abs(vsAverage).toFixed(1)} {vsAverage > 0 ? 'better' : 'worse'} than usual
                  </Text>
                </>
              ) : (
                <Text variant="caption" tone="muted">
                  About usual for this vehicle
                </Text>
              )}
            </Row>
          )}
          <Text variant="caption" tone="muted">
            {num(litresPer100(stats.latestEfficiency))} L per 100 {unit} ·{' '}
            {stats.windowCount} measured tank{stats.windowCount === 1 ? '' : 's'}
          </Text>
        </View>

        <Divider />

        <Row justify="space-between">
          <StatCell
            label="AVERAGE"
            value={num(stats.averageEfficiency)}
            // The span the average covers, so the figure has a stated period
            // rather than reading as "all time" and meaning something narrower.
            caption={monthSpan(stats.firstAt, stats.latestAt)}
          />
          <StatCell
            label="BEST"
            value={num(stats.bestEfficiency)}
            color={colors.completed}
            caption={monthOf(stats.bestAt)}
          />
          <StatCell
            label="WORST"
            value={num(stats.worstEfficiency)}
            color={colors.danger}
            caption={monthOf(stats.worstAt)}
          />
        </Row>
      </Surface>

      {/*
        Running costs, led by the one figure that makes fuel comparable to any
        other spending: what a kilometre costs.

        The supporting numbers sit as three tiles rather than a list of rows,
        because they answer different questions ("how much have I spent", "how
        far did that take me", "where is the odometer") and a flat list gives
        them all the same weight as each other and as the headline.
      */}
      <View style={{ gap: space.sm }}>
        <Label>RUNNING COSTS</Label>
        <Surface style={{ gap: space.md }}>
          <Row justify="space-between" align="center">
            <View style={{ flex: 1 }}>
              <Text variant="body">Cost per {unit}</Text>
              <Text variant="caption" tone="muted">
                Fuel only — across {stats.windowCount} measured tank
                {stats.windowCount === 1 ? '' : 's'}
              </Text>
            </View>
            <Text variant="figureLarge" color={vehicle?.color ?? colors.ink}>
              {stats.costPerDistanceMinor === null
                ? '—'
                : formatMoney(stats.costPerDistanceMinor, { showDecimals: true })}
            </Text>
          </Row>

          <Divider />

          <Row justify="space-between">
            <MiniStat
              label="SPENT"
              value={
                stats.totalCostMinor === null
                  ? '—'
                  : formatMoney(stats.totalCostMinor, { compact: true })
              }
            />
            <MiniStat
              label="DISTANCE"
              value={`${Math.round(stats.totalDistance).toLocaleString()} ${unit}`}
            />
            <MiniStat label="FUEL" value={`${stats.litresLogged.toFixed(0)} L`} />
          </Row>
        </Surface>

        {/* The odometer is a fact about the vehicle, not a cost, so it sits
            outside the card rather than competing with the figures in it. */}
        <Text variant="caption" tone="muted">
          Odometer now {stats.latestOdometer?.toLocaleString() ?? '—'} {unit}
        </Text>
      </View>

      {windows.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>TANK HISTORY</Label>
          <Surface style={{ gap: space.md }}>
            {/*
              A column per tank, oldest on the left — the shape of the trend is
              the thing being read, so time has to run in the direction people
              read it.

              Scaled to the ACTUAL range rather than from zero. Every tank of one
              car sits within a few km/L of the others, so a zero-based axis
              renders eight near-identical full-height bars and hides exactly the
              variation the chart exists to show. A little headroom above and
              below keeps the best and worst from touching the edges.
            */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 108 }}>
              {chart.map((c) => (
                <View key={c.id} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Text variant="caption" tone={c.isLatest ? 'ink' : 'muted'} style={{ fontSize: 10 }}>
                    {c.efficiency.toFixed(1)}
                  </Text>
                  <View
                    style={{
                      width: '100%',
                      height: Math.max(4, c.heightPct * 0.72),
                      borderRadius: 4,
                      // The most recent tank is the one being judged, so it is
                      // solid while the rest recede into context.
                      backgroundColor: c.isLatest
                        ? (vehicle?.color ?? colors.accent)
                        : `${vehicle?.color ?? colors.accent}55`,
                    }}
                  />
                  <Text variant="caption" tone="muted" style={{ fontSize: 9 }}>
                    {c.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* The axis the columns are scaled against, stated plainly — an
                unlabelled non-zero baseline is how charts mislead. */}
            <Row justify="space-between">
              <Text variant="caption" tone="muted">
                Worst {num(stats.worstEfficiency)} {unit}/L
              </Text>
              <Text variant="caption" tone="muted">
                Best {num(stats.bestEfficiency)} {unit}/L
              </Text>
            </Row>
          </Surface>

          {/* The same tanks as rows, for the detail a column cannot carry. */}
          <Surface padded={false}>
            {[...windows].reverse().slice(0, 5).map((w, index) => (
              <View key={w.id}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <Row
                  justify="space-between"
                  align="center"
                  style={{ paddingHorizontal: space.lg, paddingVertical: space.sm + 2 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="body">
                      {w.efficiency.toFixed(1)} {unit}/L
                    </Text>
                    <Text variant="caption" tone="muted">
                      {Math.round(w.distance).toLocaleString()} {unit} · {w.litres.toFixed(1)} L
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="caption" tone="secondary">
                      {w.costMinor === null ? '' : formatMoney(w.costMinor)}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {w.to.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                </Row>
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {/* Vehicles and the service log live behind their own screens, so this one
          stays about the numbers. */}
      <View style={{ gap: space.sm }}>
        <Label>MANAGE</Label>
        <Surface padded={false}>
          <ManageRow
            icon="build-outline"
            label="Service log"
            count={services.length}
            onPress={() => router.push(`/mini/fuel/services?vehicle=${vehicle?.id}`)}
          />
          <Divider style={{ marginHorizontal: space.lg }} />
          <ManageRow
            icon="car-sport-outline"
            label="Vehicles"
            count={vehicles.length}
            onPress={() => router.push('/mini/fuel/vehicle')}
          />
        </Surface>
      </View>
    </Screen>
  );
}

/**
 * "Aug 2026" — the month a figure came from.
 *
 * Month rather than a full date: the exact day a tank was measured on is noise
 * beside the number itself, and the useful question is whether the best tank
 * was recent or half a year ago.
 */
function monthOf(date: Date | null): string | undefined {
  if (!date) return undefined;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "Mar – Aug 2026", collapsing to one month when the span is inside it. */
function monthSpan(from: Date | null, to: Date | null): string | undefined {
  const start = monthOf(from);
  const end = monthOf(to);
  if (!start || !end) return undefined;
  return start === end ? start : `${start} – ${end}`;
}

function StatCell({
  label,
  value,
  color,
  caption,
}: {
  label: string;
  value: string;
  color?: string;
  caption?: string;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Label>{label}</Label>
      <Text variant="figure" color={color}>
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" tone="muted">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** One supporting figure under the headline cost. */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Label>{label}</Label>
      <Text variant="body">{value}</Text>
    </View>
  );
}


function ManageRow({
  icon,
  label,
  count,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count: number;
  onPress: () => void;
}) {
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={colors.inkSecondary} />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="caption" tone="muted">
        {count}
      </Text>
      <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
    </Pressable>
  );
}
