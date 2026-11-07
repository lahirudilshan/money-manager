import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Button, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { healthLabRepo } from '~/db/repositories';
import { useAppStore } from '~/store/useAppStore';
import { HealthChart } from '~/features/health/components/HealthChart';
import { usePersonHealth } from '~/features/health/components/usePersonHealth';
import {
  AiDisclaimer,
  LabResultCard,
  LabStatusPill,
  labStatusStyle,
  RangeBar,
} from '~/features/health/components/LabUi';
import { changeSincePrevious, typicalBand } from '~/features/health/logic/healthMetrics';
import { guideFor } from '~/features/health/logic/measureGuide';
import { MeasureGuideCard } from '~/features/health/components/MeasureGuideCard';

/**
 * One measure over time — every sugar, pressure or cholesterol figure this
 * person has, from lab reports AND home readings, on one chart.
 *
 * The latest value leads, explained: when it came from a lab, with the AI's
 * "what this checks / if high / if low"; when it came from a home device, with
 * the typical range it was judged against. Below it the trend, then every
 * value with where it came from. A home reading opens to be corrected or
 * deleted; a lab value opens the report it was read from.
 */
export default function MetricScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string; key?: string }>();
  const refreshKey = useAppStore((s) => s.healthPeople);
  const key = params.key ? decodeURIComponent(params.key) : '';

  const health = usePersonHealth(params.person, refreshKey);
  const series = health.series.find((s) => s.testKey === key);

  /** The newest lab row, for the AI's explanation of what this measure is. */
  const explained = useMemo(() => {
    const labRow = series ? [...series.history].reverse().find((r) => r.source === 'lab') : undefined;
    if (!labRow || !params.person) return undefined;
    return healthLabRepo.resultsByPerson(params.person).find((r) => r.id === labRow.refId);
  }, [series, params.person]);

  if (!series || !params.person) {
    return (
      <Screen title="History" onBack={() => router.back()}>
        <Text variant="body" tone="secondary">
          Nothing recorded for this yet.
        </Text>
      </Screen>
    );
  }

  const latest = series.latest;
  const numeric = series.history.filter((r) => r.value !== null);
  const values = numeric.map((r) => r.value as number);
  const change = changeSincePrevious(series);
  const paired = series.history.some((r) => r.valueSecondary !== null);
  const band =
    latest.refLow !== null || latest.refHigh !== null
      ? { low: latest.refLow ?? 0, high: latest.refHigh ?? (latest.refLow as number) * 2 }
      : (() => {
          const typical = typicalBand(key);
          return typical ? { low: typical.low ?? 0, high: typical.high } : undefined;
        })();
  const fromHome = series.history.some((r) => r.source === 'reading');
  const status = labStatusStyle(latest.status, colors);
  const guide = guideFor(key);

  return (
    <Screen
      title={series.testName}
      onBack={() => router.back()}
      footer={
        fromHome ? (
          <Button
            label="Add a reading"
            icon="add"
            variant="secondary"
            onPress={() => router.push(`/mini/health/reading?person=${params.person}`)}
          />
        ) : undefined
      }
    >
      {/* The latest value, explained. */}
      <View style={{ gap: space.sm }}>
        <Label>LATEST</Label>
        {latest.source === 'lab' && explained ? (
          <LabResultCard result={explained} initiallyOpen />
        ) : (
          <Surface>
            <View style={{ gap: space.md }}>
              <Row style={{ alignItems: 'flex-end', gap: space.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
                    {latest.valueText}
                    {latest.unit ? (
                      <Text variant="body" tone="secondary">{` ${latest.unit}`}</Text>
                    ) : null}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {`Home reading · ${longDate(latest.measuredAt)}`}
                  </Text>
                </View>
                <LabStatusPill status={latest.status} />
              </Row>
              <RangeBar
                value={latest.value}
                refLow={latest.refLow}
                refHigh={latest.refHigh}
                status={latest.status}
              />
              {latest.status !== 'unknown' ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: space.sm,
                    padding: space.md,
                    borderRadius: radius.md,
                    backgroundColor: status.bg,
                  }}
                >
                  <Ionicons name={status.icon} size={18} color={status.fg} />
                  <Text variant="small" style={{ flex: 1 }}>
                    {homeVerdict(latest.status)}
                  </Text>
                </View>
              ) : null}
            </View>
          </Surface>
        )}
      </View>

      {/* What each level of this measure means, and does — offline, standard. */}
      {guide ? <MeasureGuideCard guide={guide} status={latest.status} /> : null}

      {/* The trend. */}
      {numeric.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>OVER TIME</Label>
          <Surface>
            <View style={{ gap: space.md }}>
              <HealthChart
                points={numeric.map((r) => ({
                  at: r.measuredAt,
                  value: r.value as number,
                  valueSecondary: r.valueSecondary,
                }))}
                band={band}
                height={150}
                color={colors.accent}
                showSecondary={paired}
              />
              <Row style={{ gap: space.lg }}>
                <Figure label="Lowest" value={fmt(Math.min(...values))} unit={latest.unit} />
                <Figure label="Highest" value={fmt(Math.max(...values))} unit={latest.unit} />
                <Figure
                  label="Last change"
                  value={
                    change === null
                      ? 'Not set'
                      : `${change.delta > 0 ? '+' : change.delta < 0 ? '−' : ''}${fmt(Math.abs(change.delta))}`
                  }
                  unit={change === null ? null : latest.unit}
                />
              </Row>
              {band ? (
                <Text variant="caption" tone="secondary">
                  The green band is the normal range
                  {latest.source === 'lab' ? ' printed on your latest report.' : ' for most adults.'}
                </Text>
              ) : null}
            </View>
          </Surface>
        </View>
      ) : null}

      {/* Every value, with where it came from. */}
      <View style={{ gap: space.sm }}>
        <Label>{`ALL RESULTS · ${series.history.length}`}</Label>
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          {[...series.history].reverse().map((r, index) => (
            <Pressable
              key={r.id}
              onPress={() =>
                r.source === 'reading'
                  ? router.push(`/mini/health/reading?id=${r.refId}`)
                  : router.push(`/mini/health/analysis?id=${r.analysisId}`)
              }
              accessibilityRole="button"
              accessibilityHint={
                r.source === 'reading' ? 'Edit or delete this reading' : 'Open the report'
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.md,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.hairline,
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.sm,
                  backgroundColor: r.source === 'lab' ? colors.accentSoft : colors.surfaceSunken,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={r.source === 'lab' ? 'flask-outline' : 'home-outline'}
                  size={16}
                  color={r.source === 'lab' ? colors.accent : colors.inkSecondary}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
                  {r.unit ? `${r.valueText} ${r.unit}` : r.valueText}
                </Text>
                <Text variant="caption" tone="secondary">
                  {`${longDate(r.measuredAt)} · ${r.source === 'lab' ? 'Lab report' : 'Home reading'}`}
                </Text>
              </View>
              <LabStatusPill status={r.status} />
              <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
            </Pressable>
          ))}
        </Surface>
      </View>

      <AiDisclaimer />
    </Screen>
  );
}

/** What a home reading's verdict means, plainly. */
function homeVerdict(status: string): string {
  switch (status) {
    case 'normal':
      return 'In the normal range for most adults.';
    case 'borderline':
      return 'A little above the ideal range. Worth watching, and worth mentioning at your next check-up.';
    case 'high':
      return 'Above the normal range. If readings stay this high, talk to your doctor.';
    case 'low':
      return 'Below the normal range. If you feel unwell or it keeps happening, talk to your doctor.';
    default:
      return '';
  }
}

function Figure({ label, value, unit }: { label: string; value: string; unit: string | null }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text
        variant="figure"
        tone={value === 'Not set' ? 'muted' : 'ink'}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
        {unit && value !== 'Not set' ? (
          <Text variant="caption" tone="secondary">{` ${unit}`}</Text>
        ) : null}
      </Text>
    </View>
  );
}

function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
