import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { HealthLabResult } from '~/db/schema';
import { normalRangeText, type MetricRow } from '~/features/health/logic/healthMetrics';
import { adviceFor, guideFor } from '~/features/health/logic/measureGuide';
import { isOrAre, plainName, tidyValue } from '~/features/health/logic/plainTests';
import { GlossaryText, labStatusStyle, RangeBar } from './LabUi';

/**
 * One result, explained for someone who has never read a lab report:
 *
 *   ↑  Your blood sugar is HIGH
 *      142 mg/dL · 3 Oct 2026 · lab report
 *      [ low | normal | ● high ]
 *   WHAT IT MEANS      — the guide's words for this level, or the AI's
 *   WHAT IT CAN DO     — what it does to the body (only when off)
 *   WHAT TO DO         — always present, highlighted
 *   GET HELP NOW IF…   — the urgent line, only when off
 *
 * Works for home readings and lab values alike: the offline guide covers the
 * common measures, the AI's own words cover the rest of a lab report, and a
 * plain "show this to your doctor" covers anything with neither.
 */
export function PlainResultCard({
  testKey,
  testName,
  latest,
  lab,
}: {
  testKey: string;
  testName: string;
  latest: MetricRow;
  /** The saved lab result behind `latest`, for the AI's words about it. */
  lab?: HealthLabResult;
}) {
  const { colors, radius, space } = useTheme();
  const status = labStatusStyle(latest.status, colors);
  const advice = adviceFor(testKey, latest.status, { ifHigh: lab?.ifHigh, ifLow: lab?.ifLow });
  const guide = guideFor(testKey);
  const normal = normalRangeText(latest);
  const off = latest.status !== 'normal' && latest.status !== 'unknown';
  const word =
    latest.status === 'borderline'
      ? 'A LITTLE HIGH'
      : latest.status === 'unknown'
        ? null
        : status.label.toUpperCase();
  const checks = guide?.what ?? lab?.meaning ?? null;
  const displayName = plainName(testKey, testName, latest.unit);
  const date = latest.measuredAt.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Surface>
      <View style={{ gap: space.lg }}>
        <Row style={{ gap: space.md, alignItems: 'center' }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: status.bg,
            }}
          >
            <Ionicons name={status.icon} size={30} color={status.fg} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading">
              {word ? `${displayName} ${isOrAre(displayName)} ` : displayName}
              {word ? (
                <Text variant="heading" color={status.fg}>
                  {word}
                </Text>
              ) : null}
            </Text>
            <Text variant="small" tone="secondary">
              {`${advice.levelName} · ${date} · ${latest.source === 'lab' ? 'lab report' : 'home reading'}`}
            </Text>
          </View>
        </Row>

        <View style={{ gap: space.xs }}>
          <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
            {tidyValue(latest.valueText)}
            {latest.unit ? <Text variant="body" tone="secondary">{` ${latest.unit}`}</Text> : null}
          </Text>
          {normal ? (
            <Text variant="small" tone="secondary">
              {`Normal is ${normal}${testKey === 'blood_pressure' ? ' mmHg' : latest.unit ? ` ${latest.unit}` : ''}`}
            </Text>
          ) : null}
        </View>

        <RangeBar
          value={latest.value}
          refLow={latest.refLow}
          refHigh={latest.refHigh}
          status={latest.status}
        />

        {lab?.explanation || advice.meaning ? (
          <Block icon="information-circle" color={colors.accent} title="What it means">
            {lab?.explanation ? (
              <GlossaryText variant="body">{lab.explanation}</GlossaryText>
            ) : (
              <Text variant="body">{advice.meaning}</Text>
            )}
          </Block>
        ) : null}

        {off && advice.effects ? (
          <Block icon="body" color={status.fg} title="What it can do to your body">
            <Text variant="body">{advice.effects}</Text>
          </Block>
        ) : null}

        <View
          style={{
            gap: space.xs,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: off ? colors.accentSoft : colors.completedSoft,
          }}
        >
          <Row gap={6}>
            <Ionicons
              name={off ? 'footsteps' : 'checkmark-circle'}
              size={16}
              color={off ? colors.accentInk : colors.completed}
            />
            <Text variant="label" color={off ? colors.accentInk : colors.completed}>
              WHAT TO DO
            </Text>
          </Row>
          <Text variant="bodyStrong">{advice.todo}</Text>
        </View>

        {advice.urgent ? (
          <View
            style={{
              flexDirection: 'row',
              gap: space.sm,
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.dangerSoft,
            }}
          >
            <Ionicons name="warning" size={18} color={colors.danger} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" color={colors.danger}>
                GET HELP NOW IF
              </Text>
              <Text variant="small">{advice.urgent}</Text>
            </View>
          </View>
        ) : null}

        {checks ? (
          <Text variant="caption" tone="secondary">
            <Text variant="caption" style={{ fontWeight: '700' }}>
              {'What this test checks: '}
            </Text>
            {checks}
          </Text>
        ) : null}
      </View>
    </Surface>
  );
}

function Block({
  icon,
  color,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  children: React.ReactNode;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Row gap={6}>
        <Ionicons name={icon} size={16} color={color} />
        <Text variant="label" tone="muted">
          {title.toUpperCase()}
        </Text>
      </Row>
      {children}
    </View>
  );
}
