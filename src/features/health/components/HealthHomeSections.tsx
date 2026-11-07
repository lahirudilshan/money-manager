import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Divider, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import {
  changeSincePrevious,
  shouldBe,
  homeSeries,
  type MetricSeries,
} from '~/features/health/logic/healthMetrics';
import { AiDisclaimer, conditionStyle, labStatusStyle } from './LabUi';
import type { PersonHealth } from './usePersonHealth';

/**
 * The sections of the redesigned health home, top to bottom:
 *
 *   CurrentHealthCard — "how am I doing?", from the latest AI read-through and
 *                       anything out of range, home readings included
 *   AskBar            — the offline "what is my sugar level?" search
 *   NumbersGrid       — the measures that matter, each with its trend
 *   SuggestionsCard   — what to watch, simple things that help, what to ask
 *
 * Ordered by the questions someone opens a health record with, most urgent
 * first. The timeline — the record of everything — moves below them: it is
 * where you go to look something up, not what you need on arrival.
 */

const metricHref = (personId: string, key: string) =>
  `/mini/health/lab-test?person=${personId}&key=${encodeURIComponent(key)}`;

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/*
 * ---------------------------------------------------------------------------
 * Current health
 * ---------------------------------------------------------------------------
 */

export function CurrentHealthCard({ personId, health }: { personId: string; health: PersonHealth }) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const { latestAnalysis, overall, flagged, series } = health;
  const scan = () => router.push(`/mini/health/analyze?person=${personId}`);

  // Nothing measured and nothing scanned: an invitation, not an empty verdict.
  if (!latestAnalysis && series.length === 0) {
    return (
      <View style={{ gap: space.sm }}>
        <Label>CURRENT HEALTH</Label>
        <Surface onPress={scan}>
          <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="sparkles" size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="heading">Understand your health in simple words</Text>
              <Text variant="small" tone="secondary">
                Scan your lab reports and AI explains every result — what is normal, what is high or
                low, and what it affects. Add home readings too, and see it all in one place.
              </Text>
              <Row style={{ gap: 4, marginTop: space.xs }}>
                <Text variant="bodyStrong" tone="accent">
                  Scan a report
                </Text>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} />
              </Row>
            </View>
          </Row>
        </Surface>
      </View>
    );
  }

  /*
   * The verdict. With an analysis, its words; without one, a plain reading of
   * the numbers — never a made-up diagnosis, just "N things are out of range".
   */
  const condition = conditionStyle(
    overall?.condition ?? (flagged.length > 0 ? 'fair' : 'good'),
    colors,
  );
  /*
   * Said once, plainly. The condition is the title; the line under it is the
   * count — no separate headline repeating it, no "needs a look" label over
   * rows that already say what is wrong.
   */
  const subtitle = latestAnalysis
    ? `From reports on ${shortDate(latestAnalysis.reportDate)}`
    : flagged.length > 0
      ? `${flagged.length === 1 ? '1 reading needs' : `${flagged.length} readings need`} a look`
      : 'Your recent readings are all in the normal range';
  const shownFlags = flagged.slice(0, 4);
  const moreFlags = flagged.length - shownFlags.length;

  return (
    <View style={{ gap: space.sm }}>
      <Label>CURRENT HEALTH</Label>
      <Surface padded={false} style={{ overflow: 'hidden' }}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: condition.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={condition.icon} size={24} color={condition.fg} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{condition.label}</Text>
              <Text variant="small" tone="secondary">
                {subtitle}
              </Text>
            </View>
          </Row>

          {latestAnalysis ? (
            <View style={{ gap: space.xs }}>
              <Text variant="heading">{latestAnalysis.headline}</Text>
              {latestAnalysis.summary ? (
                <Text variant="body" tone="secondary" numberOfLines={4}>
                  {latestAnalysis.summary}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* What is off: one callout each, the number large. */}
          {shownFlags.map((s) => (
            <FlaggedCallout
              key={s.testKey}
              series={s}
              onPress={() => router.push(metricHref(personId, s.testKey))}
            />
          ))}
          {moreFlags > 0 ? (
            <Text variant="caption" tone="secondary">
              {`and ${moreFlags} more in My numbers`}
            </Text>
          ) : null}
        </View>

        {/* The next step: the full read-through, or a scan to get one. */}
        <Divider />
        <Pressable
          onPress={() =>
            latestAnalysis ? router.push(`/mini/health/analysis?id=${latestAnalysis.id}`) : scan()
          }
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
          })}
        >
          <Ionicons
            name={latestAnalysis ? 'document-text-outline' : 'scan-outline'}
            size={18}
            color={colors.accent}
          />
          <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
            {latestAnalysis ? 'Read the full analysis' : 'Scan a lab report for a full read'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </Pressable>

        {latestAnalysis ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
            <AiDisclaimer compact />
          </View>
        ) : null}
      </Surface>
    </View>
  );
}

/**
 * One out-of-range measure, as a callout on its status tint:
 *
 *   ┌──────────────────────────────────────┐
 *   │ ↓ LOW · BLOOD PRESSURE      15 Aug › │
 *   │ 128/50 mmHg                          │
 *   │ The bottom number should be 60–79    │
 *   └──────────────────────────────────────┘
 *
 * Three lines, in the order they matter: what and how, the number, what it
 * should be. The status word sits with its icon (never colour alone), the
 * figure is the largest thing, and the sentence names the part that is off.
 */
function FlaggedCallout({ series, onPress }: { series: MetricSeries; onPress: () => void }) {
  const { colors, radius, space } = useTheme();
  const latest = series.latest;
  const status = labStatusStyle(latest.status, colors);
  const should = shouldBe(latest);
  const when = latest.measuredAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.testName} is ${status.label.toLowerCase()}: ${latest.valueText} ${latest.unit ?? ''} on ${when}. ${should ?? ''}`}
      style={({ pressed }) => ({
        padding: space.md,
        gap: space.xs,
        borderRadius: radius.md,
        backgroundColor: status.bg,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <Ionicons name={status.icon} size={16} color={status.fg} />
        <Text variant="label" color={status.fg} numberOfLines={1} style={{ flex: 1 }}>
          {`${status.label} · ${series.testName}`.toUpperCase()}
        </Text>
        <Text variant="caption" tone="secondary">
          {when}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.inkSecondary} />
      </Row>

      <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
        {latest.valueText}
        {latest.unit ? (
          <Text variant="body" tone="secondary">{` ${latest.unit}`}</Text>
        ) : null}
      </Text>

      {should ? <Text variant="small">{should}</Text> : null}
    </Pressable>
  );
}

/*
 * ---------------------------------------------------------------------------
 * Ask
 * ---------------------------------------------------------------------------
 */

export function AskBar({ personId }: { personId: string }) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/mini/health/labs?person=${personId}&focus=1`)}
      accessibilityRole="search"
      accessibilityLabel="Ask about your health numbers"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
      })}
    >
      <Ionicons name="search" size={18} color={colors.inkSecondary} />
      <Text variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
        Ask: what is my sugar level?
      </Text>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}

/*
 * ---------------------------------------------------------------------------
 * My numbers
 * ---------------------------------------------------------------------------
 */

export function NumbersGrid({ personId, health }: { personId: string; health: PersonHealth }) {
  const { colors, space } = useTheme();
  const router = useRouter();
  if (health.series.length === 0) return null;
  const shown = homeSeries(health.series);

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ alignItems: 'center', paddingHorizontal: space.xs }}>
        <Label>MY NUMBERS</Label>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push(`/mini/health/labs?person=${personId}`)}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
            {`See all ${health.series.length}`}
          </Text>
        </Pressable>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {shown.map((s) => (
          <NumberTile
            key={s.testKey}
            series={s}
            onPress={() => router.push(metricHref(personId, s.testKey))}
          />
        ))}
      </View>
    </View>
  );
}

function NumberTile({ series, onPress }: { series: MetricSeries; onPress: () => void }) {
  const { colors, radius, space } = useTheme();
  const latest = series.latest;
  const status = labStatusStyle(latest.status, colors);
  const change = changeSincePrevious(series);
  const values = series.history.filter((r) => r.value !== null).map((r) => r.value as number);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.testName}, ${latest.valueText} ${latest.unit ?? ''}, ${status.label}`}
      style={({ pressed }) => ({
        width: '48.5%',
        padding: space.md,
        gap: space.xs,
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
      })}
    >
      <Row style={{ gap: 4, alignItems: 'center' }}>
        <Ionicons name={status.icon} size={13} color={status.fg} />
        <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {series.testName}
        </Text>
      </Row>
      <Text variant="figureLarge" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {latest.valueText}
        {latest.unit ? (
          <Text variant="caption" tone="secondary">{` ${latest.unit}`}</Text>
        ) : null}
      </Text>
      <Sparkline values={values} color={status.fg} />
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {change
          ? `${
              change.delta === 0
                ? 'No change'
                : change.delta > 0
                  ? `↑ ${fmt(change.delta)}`
                  : `↓ ${fmt(-change.delta)}`
            } since ${change.since.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
          : latest.source === 'lab'
            ? 'From a lab report'
            : 'One reading so far'}
      </Text>
    </Pressable>
  );
}

function fmt(n: number): string {
  return String(Number(n.toFixed(1)));
}

/** A tiny trend line. Two points make a line; fewer draws a flat rule. */
function Sparkline({ values, color }: { values: readonly number[]; color: string }) {
  const { colors } = useTheme();
  const W = 100;
  const H = 24;
  if (values.length < 2) {
    return (
      <View style={{ height: H, justifyContent: 'center' }}>
        <View style={{ height: 2, borderRadius: 1, backgroundColor: colors.surfaceSunken }} />
      </View>
    );
  }
  const recent = values.slice(-8);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const span = max - min || 1;
  const points = recent
    .map((v, i) => `${(i / (recent.length - 1)) * W},${H - 3 - ((v - min) / span) * (H - 6)}`)
    .join(' ');
  return (
    <View style={{ height: H }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      </Svg>
    </View>
  );
}

/*
 * ---------------------------------------------------------------------------
 * Suggestions
 * ---------------------------------------------------------------------------
 */

/**
 * What to do with it: from the latest AI read-through.
 *
 * Collapsed to the first few lines of each list, because three lists of five
 * on the home screen is a page of text above the record itself. "Show more"
 * opens them in place.
 */
export function SuggestionsCard({ health }: { health: PersonHealth }) {
  const { colors, space } = useTheme();
  const [open, setOpen] = useState(false);
  const overall = health.overall;
  if (!overall) return null;

  type Section = {
    key: string;
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    items: string[];
  };
  const all: Section[] = [
    { key: 'watch', title: 'Keep an eye on', icon: 'eye', color: colors.pending, items: overall.watchOut },
    { key: 'tips', title: 'Simple things that often help', icon: 'leaf-outline', color: colors.completed, items: overall.tips },
    { key: 'ask', title: 'Ask your doctor', icon: 'chatbubble-ellipses-outline', color: colors.accent, items: overall.questionsForDoctor },
  ];
  const sections = all.filter((s) => s.items.length > 0);
  if (sections.length === 0) return null;

  const limit = open ? Infinity : 2;
  const hidden = sections.reduce((n, s) => n + Math.max(0, s.items.length - 2), 0);

  return (
    <View style={{ gap: space.sm }}>
      <Label>SUGGESTIONS</Label>
      <Surface>
        <View style={{ gap: space.lg }}>
          {sections.map((section) => (
            <View key={section.key} style={{ gap: space.sm }}>
              <Text variant="small" style={{ fontWeight: '700' }}>
                {section.title}
              </Text>
              {section.items.slice(0, limit).map((item, index) => (
                <View key={index} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                  <Ionicons name={section.icon} size={16} color={section.color} style={{ marginTop: 2 }} />
                  <Text variant="body" style={{ flex: 1 }}>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          ))}
          {hidden > 0 ? (
            <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" hitSlop={8}>
              <Row style={{ gap: 4 }}>
                <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
                  {open ? 'Show less' : `Show ${hidden} more`}
                </Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
              </Row>
            </Pressable>
          ) : null}
          <AiDisclaimer compact />
        </View>
      </Surface>
    </View>
  );
}

