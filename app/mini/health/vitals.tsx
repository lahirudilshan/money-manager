import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Empty, GradientButton, Label, Row, Surface, Text } from '../../../src/components/ui';
import { Screen } from '../../../src/components/Screen';
import { HealthChart, METRIC_BAND } from '../../../src/components/HealthChart';
import { formatReading, trend, type TimelineReading } from '../../../src/core/health';
import { healthReadingRepo } from '../../../src/db/repositories';
import {
  HEALTH_METRIC_LABEL,
  HEALTH_METRIC_UNIT,
  isPairedMetric,
  READING_CONTEXT_LABEL,
  type HealthMetric,
  type ReadingContext,
} from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Readings over time — the payoff for having recorded them.
 *
 * This screen did not exist, which meant `trend()` was computed in the core and
 * displayed nowhere: someone could log a blood pressure every week for a year
 * and never see the shape of it. A health record that can only be written and
 * not read is a filing cabinet, and nobody keeps filing into one.
 *
 * Organised by METRIC rather than by date, because that is the question — "how
 * has her sugar been?" — and a date-ordered list of mixed measurements cannot
 * answer it. The timeline on the home screen already covers "what happened
 * lately".
 */
export default function HealthVitals() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string; metric?: string }>();
  const store = useAppStore();

  const person =
    store.healthPeople.find((p) => p.id === params.person) ?? store.healthPeople[0];

  const readings = useMemo<TimelineReading[]>(() => {
    if (!person) return [];
    return healthReadingRepo.byPerson(person.id).map((row) => ({
      id: row.id,
      personId: row.personId,
      metric: row.metric,
      value: row.value,
      valueSecondary: row.valueSecondary,
      unit: row.unit,
      context: row.context,
      measuredAt: row.measuredAt,
    }));
  }, [person, store.healthPeople]);

  /** Only the metrics this person actually has readings for. */
  const metrics = useMemo(() => {
    const seen = new Set(readings.map((reading) => reading.metric));
    return [...seen] as HealthMetric[];
  }, [readings]);

  const [metric, setMetric] = useState<HealthMetric | null>(
    (params.metric as HealthMetric) ?? null,
  );
  const active = metric && metrics.includes(metric) ? metric : (metrics[0] ?? null);

  /**
   * Blood sugar is split by context; everything else is one series.
   *
   * Fasting and post-meal are different measurements that share a unit, so a
   * single line through both describes neither (see `trend`). Offering the
   * split as a filter is the honest way to chart them.
   */
  const [context, setContext] = useState<ReadingContext | null>(null);
  const contexts = useMemo(() => {
    if (active !== 'blood_sugar') return [];
    const seen = new Set(
      readings
        .filter((reading) => reading.metric === active && reading.context)
        .map((reading) => reading.context as ReadingContext),
    );
    return [...seen];
  }, [readings, active]);

  const series = useMemo(
    () =>
      active
        ? trend(readings, {
            metric: active,
            context: active === 'blood_sugar' ? context : null,
          })
        : null,
    [readings, active, context],
  );

  const unit = active ? HEALTH_METRIC_UNIT[active] : '';

  if (!person) {
    return (
      <Screen title="Readings" onBack={() => router.back()}>
        <Text variant="small" tone="secondary">
          Add a person first.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      title={`${person.name}'s readings`}
      onBack={() => router.back()}
      footer={
        <GradientButton
          label="Add a reading"
          icon="add"
          onPress={() => router.push(`/mini/health/reading?person=${person.id}`)}
        />
      }
    >
      {metrics.length === 0 ? (
        <Empty
          icon="pulse-outline"
          title="No readings yet"
          message="Record a blood pressure, sugar or weight and the trend appears here."
          actionLabel="Add a reading"
          onAction={() => router.push(`/mini/health/reading?person=${person.id}`)}
        />
      ) : (
        <>
          {/* Which measurement — only when there is more than one to choose. */}
          {metrics.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
            >
              {metrics.map((key) => {
                const selected = key === active;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setMetric(key);
                      setContext(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.75 : 1,
                      paddingVertical: space.sm,
                      paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      backgroundColor: selected ? colors.accent : colors.surface,
                      borderWidth: 1,
                      borderColor: selected ? colors.accent : colors.hairline,
                    })}
                  >
                    <Text
                      variant="small"
                      color={selected ? colors.inkInverse : colors.inkSecondary}
                      style={{ fontWeight: selected ? '700' : '500' }}
                    >
                      {HEALTH_METRIC_LABEL[key]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {active && series ? (
            <>
              {/* Fasting vs post-meal, where it applies. */}
              {contexts.length > 1 ? (
                <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                  <ContextChip
                    label="All"
                    selected={context === null}
                    onPress={() => setContext(null)}
                  />
                  {contexts.map((key) => (
                    <ContextChip
                      key={key}
                      label={READING_CONTEXT_LABEL[key]}
                      selected={context === key}
                      onPress={() => setContext(key)}
                    />
                  ))}
                </Row>
              ) : null}

              {/* The latest figure, big — it is what someone opens this for. */}
              <Surface style={{ gap: space.md }}>
                <Row>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Label>LATEST</Label>
                    <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
                      <Text variant="figureLarge">
                        {series.latest
                          ? formatReading({
                              metric: active,
                              value: series.latest.value,
                              valueSecondary: series.latest.valueSecondary,
                              unit: null,
                            })
                          : '—'}
                      </Text>
                      {unit ? (
                        <Text variant="small" tone="muted">
                          {unit}
                        </Text>
                      ) : null}
                    </Row>
                    {series.latest ? (
                      <Text variant="caption" tone="muted">
                        {series.latest.at.toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                    ) : null}
                  </View>

                  {/*
                    The change since the first reading in view.

                    Stated in the metric's own units rather than as a
                    percentage: "up 12" against a number someone recognises
                    means something, "up 9%" does not. Direction is neutral —
                    up is not coloured bad, because for weight or oxygen it
                    is not.
                  */}
                  {series.change !== null && series.direction ? (
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Label>CHANGE</Label>
                      <Row gap={4}>
                        <Ionicons
                          name={
                            series.direction === 'up'
                              ? 'arrow-up'
                              : series.direction === 'down'
                                ? 'arrow-down'
                                : 'remove'
                          }
                          size={15}
                          color={colors.inkSecondary}
                        />
                        <Text variant="bodyStrong">
                          {series.direction === 'flat'
                            ? 'No change'
                            : // Trailing ".0" is noise on a whole number, and
                              // most readings are whole numbers.
                              Math.abs(series.change) % 1 === 0
                              ? String(Math.abs(series.change))
                              : Math.abs(series.change).toFixed(1)}
                        </Text>
                      </Row>
                    </View>
                  ) : null}
                </Row>

                <HealthChart
                  points={series.points}
                  band={METRIC_BAND[active]}
                  showSecondary={isPairedMetric(active)}
                  color={colors.accent}
                />

                {/*
                  The summary figures.

                  For a paired metric these describe the SYSTOLIC line only —
                  said out loud underneath, because "average 138.8" beside a
                  "129/82" headline otherwise looks like it disagrees with it.
                */}
                {series.points.length > 1 ? (
                  <View style={{ gap: 6 }}>
                    <Row gap={space.lg}>
                      <Stat label="AVERAGE" value={trim(series.average)} />
                      <Stat label="LOWEST" value={trim(series.min)} />
                      <Stat label="HIGHEST" value={trim(series.max)} />
                      <Stat label="READINGS" value={String(series.points.length)} />
                    </Row>
                    <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
                      {isPairedMetric(active) ? 'Systolic only' : unit || 'Across all readings'}
                    </Text>
                  </View>
                ) : null}
              </Surface>

              {/* Every reading, so a figure on the chart can be identified. */}
              <View style={{ gap: space.sm }}>
                <Label>ALL {HEALTH_METRIC_LABEL[active].toUpperCase()} READINGS</Label>
                <Surface padded={false} style={{ overflow: 'hidden' }}>
                  {readings
                    .filter((reading) => reading.metric === active)
                    .filter((reading) =>
                      active === 'blood_sugar' && context
                        ? reading.context === context
                        : true,
                    )
                    .map((reading, index) => (
                      <View key={reading.id}>
                        {index > 0 ? (
                          <View
                            style={{
                              height: 1,
                              backgroundColor: colors.hairline,
                              marginLeft: space.lg,
                            }}
                          />
                        ) : null}
                        <Row
                          gap={space.md}
                          style={{
                            paddingHorizontal: space.lg,
                            paddingVertical: space.md,
                          }}
                        >
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="bodyStrong">
                              {formatReading({
                                metric: reading.metric,
                                value: reading.value,
                                valueSecondary: reading.valueSecondary,
                                unit: reading.unit,
                              })}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {reading.measuredAt.toLocaleDateString(undefined, {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                              })}
                              {reading.context
                                ? ` · ${READING_CONTEXT_LABEL[reading.context as ReadingContext]}`
                                : ''}
                            </Text>
                          </View>
                        </Row>
                      </View>
                    ))}
                </Surface>
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/** A figure without a pointless trailing ".0" — most readings are whole. */
function trim(value: number | null): string {
  if (value === null) return '—';
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

/** A small label/figure pair for the summary row under the chart. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Label>{label}</Label>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

function ContextChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        paddingVertical: 6,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.accentSoft : 'transparent',
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.hairline,
      })}
    >
      <Text
        variant="caption"
        color={selected ? colors.accent : colors.inkSecondary}
        style={{ fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
